/**
 * sw.js - Service Worker สำหรับ PWA
 * ระบบตรวจ 5ส โรงงาน
 */

const CACHE_NAME = '5s-audit-v1.6'; // v1.6: schedule + criteria pages, assigned tasks, Admin board
const STATIC_ASSETS = [
  'index.html',
  'home.html',
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

// Fetch: ปล่อย GAS API ผ่านตรงๆ ไม่ intercept
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // ❌ ไม่ intercept GAS / Google APIs — ให้ browser จัดการเอง
  if (url.hostname.includes('script.google.com') ||
      url.hostname.includes('googleusercontent.com') ||
      url.hostname.includes('googleapis.com')) {
    return;
  }

  // ❌ ไม่ intercept cross-origin requests อื่นๆ
  if (url.origin !== location.origin) {
    return;
  }

  // ✅ Static assets เท่านั้น: Cache First
  event.respondWith(
    caches.match(event.request)
      .then(cached => cached || fetch(event.request)
        .then(response => {
          // Cache เฉพาะ response ที่ดี
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
      )
  );
});
