import { fetchVapidPublicKey, subscribePush, unsubscribePush, sendTestPush } from './api/push';

export type NotificationStatus = 'unsupported' | 'denied' | 'subscribed' | 'unsubscribed';

function isSupported(): boolean {
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from(rawData, (c) => c.charCodeAt(0));
}

export async function getNotificationStatus(): Promise<NotificationStatus> {
  if (!isSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  return subscription ? 'subscribed' : 'unsubscribed';
}

export async function enableNotifications(): Promise<void> {
  if (!isSupported()) throw new Error('Push notifications are not supported on this device.');

  const permission = await Notification.requestPermission();
  if (permission === 'denied') throw new Error('Notification permission was denied.');
  if (permission !== 'granted') throw new Error('Notification permission was not granted.');

  const { publicKey } = await fetchVapidPublicKey();

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error('The push subscription is missing required keys.');
  }
  await subscribePush({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } });
}

export async function disableNotifications(): Promise<void> {
  if (!isSupported()) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (subscription) {
    await unsubscribePush(subscription.endpoint);
    await subscription.unsubscribe();
  }
}

export { sendTestPush };
