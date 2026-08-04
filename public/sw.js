const CACHE = 'streetsweep-shell-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icon.svg', '/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    const url = new URL(req.url);

    // NEVER intercept API calls or anything cross-origin (Overpass, Strava, tiles).
    if (url.origin !== self.location.origin) return;
    if (url.pathname.startsWith('/api/')) return;
    if (req.method !== 'GET') return;

    // Navigations: network-first, fall back to cached shell offline.
    if (req.mode === 'navigate') {
        event.respondWith(fetch(req).catch(() => caches.match('/')));
        return;
    }

    // Same-origin static GETs: cache-first, then network (and cache a copy).
    event.respondWith(
        caches.match(req).then((hit) =>
            hit || fetch(req).then((res) => {
                const copy = res.clone();
                caches.open(CACHE).then((c) => c.put(req, copy));
                return res;
            })
        )
    );
});
