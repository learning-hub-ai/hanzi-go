const CACHE_VERSION = 'hanzigo-v128';
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './config.json',
  './css/style.css',
  './js/error-log.js',
  './js/constants.js',
  './js/state.js',
  './js/data.js',
  './js/services.js',
  './js/ui.js',
  './js/controllers.js',
  './js/daily-task.js',
  './js/story-unlock.js',
  './js/story.js',
  './js/story-invite.js',
  './js/mobile.js',
  './assets/icon-192.png',
  './assets/icon-512.png',
  // 多音字 readings — without this the offline app speaks 爪 as zhǎo
  // instead of the textbook's zhuǎ.
  './data/heteronyms.json',
  // Which recorded syllables exist (a few KB). The recordings themselves
  // (several MB, see the index) are not pre-cached: the same-origin rule below
  // caches each one the first time it plays, so a first visit stays small
  // and a card heard once works offline afterwards.
  './audio/syllables/index.json'
];

// Data files to cache (all grade/semester JSON)
const DATA_ASSETS = [];
for (let g = 1; g <= 9; g++) {
  for (let s = 1; s <= 2; s++) {
    DATA_ASSETS.push(`./data/grade${g}-semester${s}.json`);
  }
}
// 小故事, encrypted (design §7.5): the plain story files are not on the site.
// Pre-cached so stories open offline from the first visit; fetched
// network-first below so new stories and revoked codes take effect soon.
const STORY_FILE = './data/stories.enc.json';
DATA_ASSETS.push(STORY_FILE);
// The characters' pictures on the cast page (a few KB in all).
for (const f of ['feifei', 'lele', 'xiaotian', 'xiaobai', 'xiaogua', 'manyeye', 'baba', 'mama']) {
  DATA_ASSETS.push(`./assets/characters/${f}.svg`);
}

const ALL_ASSETS = [...STATIC_ASSETS, ...DATA_ASSETS];

// Install: pre-cache all static assets and data
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(ALL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/**
 * Try the network for `timeoutMs`; on success refresh the cache, otherwise
 * answer from the cache (and from the network after all if nothing is cached).
 */
function networkFirst(request, timeoutMs) {
  // One network request; a server error counts as a failure so a good cached
  // copy wins over a 404/500.
  const net = fetch(request).then(response => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const clone = response.clone();
    caches.open(CACHE_VERSION).then(cache => cache.put(request, clone)).catch(() => {});
    return response;
  });
  net.catch(() => {});   // it may settle after the timeout won: never an unhandled rejection
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs));
  return Promise.race([net, timeout])
    .catch(() => caches.match(request).then(cached => cached || net.catch(() => fetch(request))));
}

// Fetch: cache-first for static assets, network-first for API/TTS
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Network-only for TTS (Baidu) — don't cache audio
  if (url.hostname.includes('baidu.com') || url.pathname === '/tts') {
    return;
  }

  // Network-first for the encrypted stories, with a short timeout so a slow
  // network does not keep the 📖 switch hidden; the cached copy otherwise.
  if (url.origin === self.location.origin && url.pathname.endsWith('/data/stories.enc.json')) {
    event.respondWith(networkFirst(event.request, 3000));
    return;
  }

  // Cache-first, network-fallback for Hanzi Writer (笔顺练习) — the library
  // script and per-character stroke data both come from jsdelivr. Caching
  // them means a character looked up once works offline afterwards; this
  // is deliberately NOT part of STATIC_ASSETS/install-time pre-cache since
  // there's no fixed list of characters to pre-fetch (see hanzi-go.md's
  // iOS audio notes for why 8MB of hanzi-writer-data isn't bundled
  // upfront — same reasoning applies here: fetch on demand, cache what's
  // actually used).
  if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('hanzi-writer')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then(cache => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Cache-first strategy for same-origin assets
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        // Not in cache — fetch from network and cache it
        return fetch(event.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then(cache => cache.put(event.request, clone));
          }
          return response;
        });
      }).catch(() => {
        // Offline fallback — return index.html for navigation requests
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      })
    );
  }
});
