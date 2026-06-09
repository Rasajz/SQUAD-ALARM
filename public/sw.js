/* ══════════════════════════════════════════════════════
   Service Worker — Squad Alarm PWA
   Handles caching, offline support, and siren audio cache
══════════════════════════════════════════════════════ */

const CACHE = 'squad-alarm-v14';

// Pre-cache essential assets on install
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(cache => {
      return cache.addAll([
        '/',
        '/icon-192.png',
        '/icon-512.png',
        '/manifest.json',
      ]).catch(() => {
        // Non-critical: if some assets fail to cache, continue
      });
    }).then(() => self.skipWaiting())
  );
});

// Clean up old caches on activate
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      )
    ).then(() => clients.claim())
  );
});

// Network-first strategy with cache fallback
self.addEventListener('fetch', (e) => {
  // Skip non-GET and Chrome extension requests
  if (e.request.method !== 'GET') return;
  if (e.request.url.startsWith('chrome-extension://')) return;

  // Skip Firebase and analytics requests (shouldn't be cached)
  const url = new URL(e.request.url);
  if (url.hostname.includes('firebaseio.com') ||
      url.hostname.includes('googleapis.com') ||
      url.hostname.includes('google-analytics.com') ||
      url.hostname.includes('gstatic.com')) {
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then(res => {
        // Only cache successful responses
        if (res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// Listen for messages from the app (e.g., cache siren audio)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CACHE_SIREN') {
    // Cache a siren audio blob URL sent from the main app
    const { url, blob } = event.data;
    if (url && blob) {
      caches.open(CACHE).then(cache => {
        const response = new Response(blob, {
          headers: { 'Content-Type': 'audio/wav' }
        });
        cache.put(url, response);
      });
    }
  }
});
