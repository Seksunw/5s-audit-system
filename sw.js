/**
 * sw.js - Service Worker สำหรับ PWA
 * ระบบตรวจ 5ส โรงงาน
 */

const CACHE_NAME = '5s-audit-v1.0';
const STATIC_ASSETS = [
  'index.html',
  'home.html',
  'plant.html',
  'area.html',
  'audit.html',
  'summary.html',
  'history.html',
  'dashboard.html',
  'css/style.css',
  'js/app.js',
  'manifest.json'
];

// Install: cache แบบ safe — ไม่หยุดถ้าบางไฟล์ไม่มี
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.allSettled(
        STATIC_ASSETS.map(url =>
          cache.add(url).catch(() => console.log('[SW] skip:', url))
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: Cache First for static, Network First for API
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API calls: Network First
  if (url.hostname.includes('script.google.com') || url.pathname.includes('/exec')) {
    event.respondWith(
      fetch(event.request)
        .catch(() => new Response(JSON.stringify({ success: false, error: 'Offline - ไม่มีอินเตอร์เน็ต' }), {
          headers: { 'Content-Type': 'application/json' }
        }))
    );
    return;
  }

  // Static assets: Cache First
  event.respondWith(
    caches.match(event.request)
      .then(cached => cached || fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
      )
  );
});
