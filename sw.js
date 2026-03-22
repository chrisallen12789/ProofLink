const CACHE = 'prooflink-v1';

const PRECACHE = [
  '/',
  '/join.html',
  '/landing-page.css',
  '/join-page.css',
  '/join-page.js',
  '/prooflink-plan-intent.js',
  '/prooflink-workspace-architecture.js',
  '/assets/favicon.png',
  '/assets/pwa-192.png',
  '/assets/pwa-512.png',
  '/manifest.webmanifest',
];

// Install — cache the app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

// Activate — remove old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Push notifications
self.addEventListener('push', (event) => {
  let data = { title: 'ProofLink', body: '', url: '/operator/' };
  try { data = { ...data, ...event.data.json() }; } catch (_) {}

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body : data.body,
      icon : '/assets/pwa-192.png',
      badge: '/assets/pwa-192.png',
      data : { url: data.url },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/operator/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const match = clients.find((c) => c.url.includes('/operator/'));
      if (match) { match.focus(); match.navigate(url); }
      else self.clients.openWindow(url);
    })
  );
});

// Fetch strategy:
// - API / Netlify functions → network only (never cache live data)
// - Everything else → network first, fall back to cache
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin requests
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // API calls — always go to network
  if (url.pathname.startsWith('/.netlify/') || url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Cache a copy of successful responses
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
