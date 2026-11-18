/* Emergency replacement: publish these bytes as /sw.js. Keep it there while clients recover. */
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  await Promise.all((await caches.keys()).filter(n=>n.startsWith('mmm-offline-')).map(n=>caches.delete(n)));
  await self.registration.unregister();
  await self.clients.claim();
})()));
