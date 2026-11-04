'use strict';
/*
 * Service worker на клиентското приложение: пази самото приложение в телефона,
 * за да се отваря и показва картата (баркода) дори без интернет.
 * Данните (точки, история) винаги се взимат от сървъра, когато има връзка.
 */
const CACHE = 'lunapark-app-v1';
const SHELL = ['/app', '/style.css', '/code128.js', '/vendor/qrcode.js', '/camera.js', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // първо мрежата (за да има винаги последната версия), при липса на връзка – от паметта
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || (e.request.mode === 'navigate' ? caches.match('/app') : undefined))),
  );
});
