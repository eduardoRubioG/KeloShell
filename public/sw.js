importScripts(
    'https://storage.googleapis.com/workbox-cdn/releases/7.4.0/workbox-sw.js'
);

workbox.core.clientsClaim();

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

workbox.precaching.precacheAndRoute(self.__WB_MANIFEST || []);

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'KeloShell';
  const options = {
    body: data.body || '',
    icon: data.icon || '/assets/icons/192x192.png',
    badge: data.badge || '/assets/icons/48x48.png',
    tag: data.tag || 'keloshell',
    data: { url: data.url || '/' },
    vibrate: data.vibrate || [100, 50, 100],
    requireInteraction: data.requireInteraction || false,
    actions: data.actions || [
      { action: 'open', title: 'Open' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(title, options).then(async () => {
      const clients = await self.clients.matchAll({ type: 'window' });
      const hasFocusedClient = clients.some((c) => c.focused);
      if (!hasFocusedClient && navigator.setAppBadge) {
        await navigator.setAppBadge();
      }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const url = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(async (clients) => {
        if (navigator.clearAppBadge) await navigator.clearAppBadge();
        const existing = clients.find((c) => c.url.includes(self.location.origin));
        if (existing) {
          await existing.focus();
          existing.navigate(url);
        } else {
          await self.clients.openWindow(url);
        }
      })
  );
});
