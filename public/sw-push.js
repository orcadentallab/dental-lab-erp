self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Orca Doctor Portal', body: event.data.text() };
  }

  const title = payload.title || 'Orca Doctor Portal';
  const options = {
    body: payload.body || '',
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag: payload.tag || 'orca-portal-notification',
    data: {
      url: payload.url || '/doctor/my-orders',
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/doctor/my-orders';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client) {
          const clientUrl = new URL(client.url);
          if (clientUrl.origin === self.location.origin) {
            if ('navigate' in client && clientUrl.pathname + clientUrl.search !== targetUrl) {
              return client.navigate(targetUrl).then((navigated) => (navigated ? navigated.focus() : client.focus()));
            }
            return client.focus();
          }
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    })
  );
});
