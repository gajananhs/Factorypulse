/* FactoryPulse service worker — bump VERSION on every deploy to refresh cached files. */
const VERSION = 'fp-v1';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'assets/css/style.css',
  'assets/js/core.js',
  'assets/js/auth.js',
  'assets/js/report.js',
  'assets/js/export.js',
  'assets/js/history.js',
  'assets/js/mplan.js',
  'assets/js/main.js',
  'assets/js/vendor/jspdf.umd.min.js',
  'assets/js/vendor/jspdf.plugin.autotable.min.js',
  'assets/images/logo.svg',
  'assets/images/favicon.svg',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Never touch the API (login sessions, reports) — always live from the network.
  if (url.origin === location.origin && url.pathname.includes('/api/')) return;

  // Page loads: network first, fall back to the cached shell when offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put('index.html', copy));
          return res;
        })
        .catch(() => caches.match('index.html'))
    );
    return;
  }

  // Static files and Google Fonts: serve from cache, refresh in the background.
  const sameOrigin = url.origin === location.origin;
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!sameOrigin && !isFont) return;

  e.respondWith(
    caches.match(req).then((cached) => {
      const fresh = fetch(req)
        .then((res) => {
          if (res && (res.ok || res.type === 'opaque')) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || fresh;
    })
  );
});
