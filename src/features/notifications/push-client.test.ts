import { beforeEach, describe, expect, it, vi } from 'vitest';

const pushApi = vi.hoisted(() => ({
  fetchVapidPublicKey: vi.fn(),
  sendTestPush: vi.fn(),
  subscribePush: vi.fn(),
  unsubscribePush: vi.fn(),
}));

vi.mock('./api/push', () => pushApi);

import { enableNotifications } from './push-client';

describe('enableNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    pushApi.fetchVapidPublicKey.mockResolvedValue({ publicKey: 'AQ' });
    pushApi.subscribePush.mockResolvedValue({ subscribed: true });

    const subscription = {
      toJSON: () => ({
        endpoint: 'https://push.example.test/subscription',
        keys: { auth: 'auth-key', p256dh: 'p256dh-key' },
      }),
    };
    const registration = {
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue(null),
        subscribe: vi.fn().mockResolvedValue(subscription),
      },
    };

    vi.stubGlobal('navigator', { serviceWorker: { ready: Promise.resolve(registration) } });
    vi.stubGlobal('window', { Notification: {}, PushManager: {} });
    vi.stubGlobal('Notification', {
      permission: 'default',
      requestPermission: vi.fn().mockResolvedValue('granted'),
    });
  });

  it('requests permission before starting the VAPID key request', async () => {
    await enableNotifications();

    const requestPermission = vi.mocked(Notification.requestPermission);
    expect(requestPermission).toHaveBeenCalledOnce();
    expect(pushApi.fetchVapidPublicKey).toHaveBeenCalledOnce();
    expect(requestPermission.mock.invocationCallOrder[0]).toBeLessThan(
      pushApi.fetchVapidPublicKey.mock.invocationCallOrder[0]
    );
  });
});
