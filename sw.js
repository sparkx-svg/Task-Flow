// TaskFlow service worker — caches the app shell so the UI still loads offline.
// Firestore's own SDK handles offline data caching/sync separately (see enableIndexedDbPersistence
// in index.html); this worker is only responsible for the static shell (HTML/CSS/JS/icons/fonts).

const CACHE_NAME = 'taskflow-shell-v1';
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // never intercept writes

  const url = new URL(req.url);

  // Never cache live Firestore/Auth API traffic — the Firestore SDK manages its
  // own offline cache/sync for that via IndexedDB persistence (see index.html).
  // (Google Fonts also lives on a *.googleapis.com host, so we check by hostname,
  // not a blanket "includes" match, to avoid also blocking font caching.)
  const liveApiHosts = ['firestore.googleapis.com', 'identitytoolkit.googleapis.com', 'securetoken.googleapis.com', 'www.googleapis.com'];
  if (liveApiHosts.includes(url.hostname) || url.hostname.includes('firebaseio.com')) {
    return;
  }

  // The Firebase SDK files on gstatic.com are pinned to an exact version in the
  // import URL (e.g. /firebasejs/10.12.2/...), so they're safe to cache-first —
  // this is what lets the app's JS actually run offline, not just its HTML/CSS.
  if (url.hostname === 'www.gstatic.com' && url.pathname.includes('/firebasejs/')) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(req).then((cached) => cached || fetch(req).then((res) => {
          cache.put(req, res.clone());
          return res;
        }))
      )
    );
    return;
  }

  // App shell (HTML/CSS/manifest/icons/fonts): network-first so users get updates
  // promptly when online, falling back to cache when offline.
  event.respondWith(
    fetch(req)
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html')))
  );
});
