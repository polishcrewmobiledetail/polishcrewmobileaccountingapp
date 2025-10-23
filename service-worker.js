const CACHE_VERSION = "pcwa-v2.2.0";
const CACHE_NAME = CACHE_VERSION;

self.addEventListener('install', e=>{
  e.waitUntil((async()=>{
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(['./','./index.html','./manifest.json','./icon-192.png','./icon-512.png']);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e=>{
  e.waitUntil((async()=>{
    const keys = await caches.keys();
    await Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener('fetch', e=>{
  if (e.request.method!=='GET') return;
  e.respondWith((async()=>{
    const cached = await caches.match(e.request);
    if (cached) return cached;
    try { return await fetch(e.request); } catch { return cached || Response.error(); }
  })());
});
