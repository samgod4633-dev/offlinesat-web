// App-shell cache so OfflineSat opens with no signal. Map tiles are NOT handled here;
// they live in IndexedDB (see js/tileStore.js). Bump VERSION when shipping changes.
const VERSION = 'v5';
const CACHE = `offlinesat-${VERSION}`;

const APP_FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/areaSelect.js',
  'js/settings.js',
  'js/tileMath.js',
  'js/tileStore.js',
  'js/offlineLayer.js',
  'js/downloader.js',
  'js/location.js',
  'js/mbtiles.js',
  'js/ui.js',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

const CDN_FILES = [
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css',
];

// Only needed for MBTiles import; a failure here must not block install.
const OPTIONAL_FILES = [
  'https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/sql-wasm.js',
  'https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/sql-wasm.wasm',
];

const CDN_HOSTS = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // cache: 'reload' skips the browser's HTTP cache so a new version never precaches stale files.
    await cache.addAll([
      ...APP_FILES.map((url) => new Request(url, { cache: 'reload' })),
      ...CDN_FILES.map((url) => new Request(url, { mode: 'cors' })),
    ]);
    await Promise.allSettled(OPTIONAL_FILES.map((url) => cache.add(new Request(url, { mode: 'cors' }))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith('offlinesat-') && n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (CDN_HOSTS.includes(url.host)) {
    // Versioned library URLs never change: cache first.
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    })());
    return;
  }

  if (url.origin !== self.location.origin) return;

  // App files: serve the cached copy instantly (works with no or weak signal),
  // refresh it in the background so the next launch gets updates.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    let cached = await cache.match(request, { ignoreSearch: true });
    if (!cached && request.mode === 'navigate') cached = await cache.match('index.html');

    const network = fetch(request)
      .then((response) => {
        if (response.ok) cache.put(request, response.clone());
        return response;
      })
      .catch(() => undefined);

    if (cached) {
      event.waitUntil(network);
      return cached;
    }
    return (await network) || new Response('Offline', { status: 503, statusText: 'Offline' });
  })());
});
