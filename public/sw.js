self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}
  const title = data.title || '🔥 HOT Lead';
  const options = {
    body: data.body || 'Ein Lead wartet auf Übernahme.',
    tag: 'wa-bot-hot-' + (data.conversationId || 'lead'),
    renotify: true,
    requireInteraction: true,
    data: { url: data.url || '/', conversationId: data.conversationId || null },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification.data?.url || '/';
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const client of list) {
      if ('focus' in client) return client.focus();
    }
    return clients.openWindow(target);
  }));
});
