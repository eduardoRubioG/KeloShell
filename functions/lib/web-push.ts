// RFC 8291 (Web Push content encryption) + RFC 8292 (VAPID) via Web Crypto.
// No Node-crypto dependency — runs natively on the Cloudflare Workers runtime.

import type { PushSubscriptionPayload, PushNotificationPayload } from '../../src/contracts/push';

export interface VapidConfig {
  publicKey: string;  // base64url-encoded uncompressed P-256 public key (65 bytes)
  privateKey: string; // base64url-encoded P-256 private scalar (32 bytes)
  subject: string;    // mailto: or https: URI
}

export interface SendResult {
  success: boolean;
  stale: boolean; // true if the push service returned 404 or 410 (expired subscription)
  status: number;
}

function base64urlToBytes(s: string): Uint8Array {
  const padding = '='.repeat((4 - (s.length % 4)) % 4);
  const base64 = (s + padding).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number
): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    baseKey,
    length * 8
  );
  return new Uint8Array(bits);
}

async function buildVapidAuthorization(endpoint: string, vapid: VapidConfig): Promise<string> {
  const url = new URL(endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;

  const enc = new TextEncoder();
  const headerB64 = bytesToBase64url(enc.encode(JSON.stringify({ alg: 'ES256', typ: 'JWT' })));
  const payloadB64 = bytesToBase64url(
    enc.encode(JSON.stringify({ aud: audience, exp, sub: vapid.subject }))
  );
  const signingInput = `${headerB64}.${payloadB64}`;

  // Build JWK from raw VAPID keys — public key is 0x04 || x (32 bytes) || y (32 bytes)
  const publicKeyBytes = base64urlToBytes(vapid.publicKey);
  const x = bytesToBase64url(publicKeyBytes.slice(1, 33));
  const y = bytesToBase64url(publicKeyBytes.slice(33, 65));

  const privateKey = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', d: vapid.privateKey, x, y, ext: true, key_ops: ['sign'] },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const signatureBuffer = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    enc.encode(signingInput)
  );

  const jwt = `${signingInput}.${bytesToBase64url(new Uint8Array(signatureBuffer))}`;
  return `vapid t=${jwt},k=${vapid.publicKey}`;
}

async function encryptPayload(
  subscription: PushSubscriptionPayload,
  plaintext: Uint8Array
): Promise<Uint8Array> {
  const uaPublicKeyBytes = base64urlToBytes(subscription.keys.p256dh);
  const authSecret = base64urlToBytes(subscription.keys.auth);

  const uaPublicKey = await crypto.subtle.importKey(
    'raw',
    uaPublicKeyBytes,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  // Ephemeral key pair for this message only
  const ephemeralPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );

  // ECDH shared secret (x-coordinate of shared point, 32 bytes)
  const sharedSecretBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: uaPublicKey },
    ephemeralPair.privateKey,
    256
  );
  const sharedSecret = new Uint8Array(sharedSecretBits);

  // Ephemeral public key as uncompressed P-256 point (65 bytes)
  const asPublicKeyBytes = new Uint8Array(
    await crypto.subtle.exportKey('raw', ephemeralPair.publicKey)
  );

  // Derive IKM: HKDF(salt=authSecret, ikm=sharedSecret, info="WebPush: info\0"+ua+as, len=32)
  const enc = new TextEncoder();
  const keyInfo = concat(enc.encode('WebPush: info\x00'), uaPublicKeyBytes, asPublicKeyBytes);
  const ikm = await hkdf(authSecret, sharedSecret, keyInfo, 32);

  // 16-byte random salt for content encryption
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // Derive 16-byte CEK and 12-byte nonce
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\x00'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\x00'), 12);

  const cekKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);

  // Pad: content + 0x02 delimiter (last/only record per RFC 8188)
  const padded = concat(plaintext, new Uint8Array([0x02]));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cekKey, padded)
  );

  // aes128gcm record: salt(16) || rs(4 big-endian) || idlen(1) || as_public(65) || ciphertext
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096, false);
  return concat(salt, rs, new Uint8Array([65]), asPublicKeyBytes, ciphertext);
}

export async function sendWebPush(
  subscription: PushSubscriptionPayload,
  notification: PushNotificationPayload,
  vapid: VapidConfig
): Promise<SendResult> {
  const plaintext = new TextEncoder().encode(JSON.stringify(notification));
  const body = await encryptPayload(subscription, plaintext);
  const authorization = await buildVapidAuthorization(subscription.endpoint, vapid);

  const response = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      'content-encoding': 'aes128gcm',
      ttl: '86400',
      authorization,
    },
    body,
  });

  const stale = response.status === 404 || response.status === 410;
  const success = response.status === 201 || response.status === 200 || response.status === 202;

  if (!success) {
    const body = await response.text().catch(() => '(unreadable)');
    console.error(`[web-push] push service ${response.status}: ${body}`);
  }

  return { success, stale, status: response.status };
}
