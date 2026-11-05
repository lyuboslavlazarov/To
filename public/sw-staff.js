'use strict';
/*
 * Service worker на приложението за служителите.
 * Пази екраните, темата и шрифтовете в устройството, за да се отварят бързо.
 * Данните (точки, игри, покупки) винаги идват от сървъра – без връзка не се записва нищо,
 * затова при липса на връзка се показва ясно съобщение.
 */
const CACHE = 'lunapark-staff-v1';
const SHELL = [
  '/', '/register.html', '/game.html', '/food.html', '/check.html', '/admin.html',
  '/style.css', '/common.js', '/camera.js', '/replace.js', '/code128.js', '/vendor/qrcode.js',
  '/theme/staff.css', '/theme/header-strip.jpg', '/fonts/fonts.css',
  '/fonts/MarckScript-400-cyrillic.woff2', '/fonts/PoiretOne-400-cyrillic.woff2',
  '/icons/staff-192.png', '/staff.webmanifest',
];
const OFFLINE = `<!doctype html><html lang="bg"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Няма връзка</title><body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#070d2b;color:#f6eedb;font-family:system-ui;text-align:center;padding:20px">
<div><div style="font-size:64px">📡</div><h1 style="color:#ffe7a3">Няма връзка със сървъра</h1>
<p>Проверете дали таблетът е в Wi-Fi мрежата на парка и дали компютърът със системата е включен.</p>
<button onclick="location.reload()" style="font-size:18px;padding:12px 24px;border:0;border-radius:10px;background:#e8b84a;color:#3a2400;font-weight:700">Опитай отново</button></div></body></html>`;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('lunapark-staff-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // първо от сървъра (винаги последната версия), без връзка – от паметта
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(e.request, { ignoreSearch: true });
        if (hit) return hit;
        if (e.request.mode === 'navigate') return new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        return Response.error();
      }),
  );
});
