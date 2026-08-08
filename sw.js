/**
 * sw.js - Service Worker สำหรับ PWA
 * ระบบตรวจ 5ส โรงงาน
 */

const CACHE_NAME = '5s-audit-v5.17'; // v5.17: PDF export ให้ตรงกับ dashboard — ทศนิยม 1 ตำแหน่งใน ranking/area score + เคารพตัวกรองโรงงาน/พื้นที่ (2026-08-08)
const STATIC_ASSETS = [
  'index.html',
  'home.html',
  'mytasks.html',    // ← Auditor assigned tasks list
  'plant.html',
  'area.html',
  'audit.html',
  'summary.html',
  'history.html',
  'dashboard.html',
  'users.html',
  'schedule.html',    // ← Admin assignment board
  'criteria.html',    // ← 5ส standards viewer
  'css/style.css',
  'manifest.json'
  // js/app.js intentionally excluded — always fetch fresh from network
];

// Install: cache HTML/CSS only, skip JS
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

// Activate: delete ALL old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch handler
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // ❌ ไม่ intercept GAS / Google APIs
  if (url.hostname.includes('script.google.com') ||
      url.hostname.includes('googleusercontent.com') ||
      url.hostname.includes('googleapis.com')) {
    return;
  }

  // ❌ ไม่ intercept cross-origin
  if (url.origin !== location.origin) {
    return;
  }

  // ❌ JS files: always fetch from network (no-store) — ไม่ cache เพื่อให้ได้ version ใหม่เสมอ
  if (url.pathname.endsWith('.js') || url.search.includes('v=')) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .catch(() => caches.match(event.request)) // fallback to cache if offline
    );
    return;
  }

  // ✅ HTML/CSS: Cache First
  event.respondWith(
    caches.match(event.request)
      .then(cached => cached || fetch(event.request)
        .then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
      )
  );
});
