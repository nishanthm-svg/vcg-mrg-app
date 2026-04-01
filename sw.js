const CACHE_NAME = 'vcg-mrg-v1';
const STATIC_ASSETS = ['/', '/index.html', '/app.js', '/styles.css'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Network first for API calls (Google Apps Script)
  if (url.hostname.includes('script.google.com')) {
    e.respondWith(
      fetch(e.request).catch(() => new Response(JSON.stringify({error:'offline'}), {headers:{'Content-Type':'application/json'}}))
    );
    return;
  }

  // Cache first for data files
  if (url.pathname.includes('/data/')) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        const network = fetch(e.request).then(res => {
          caches.open(CACHE_NAME).then(c => c.put(e.request, res.clone()));
          return res;
        });
        return cached || network;
      })
    );
    return;
  }

  // Cache first for static assets
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});

// Background sync for offline submissions
self.addEventListener('sync', e => {
  if (e.tag === 'sync-submissions') {
    e.waitUntil(syncPendingSubmissions());
  }
});

async function syncPendingSubmissions() {
  const db = await openDB();
  const tx = db.transaction('pending', 'readonly');
  const pending = await getAllFromStore(tx.objectStore('pending'));

  for (const item of pending) {
    try {
      const GAS_URL = await getGASUrl();
      await fetch(GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item.data)
      });
      const delTx = db.transaction('pending', 'readwrite');
      delTx.objectStore('pending').delete(item.id);
    } catch {}
  }
}

function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('vcgmrg', 1);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

function getAllFromStore(store) {
  return new Promise((res, rej) => {
    const req = store.getAll();
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function getGASUrl() {
  const cache = await caches.open(CACHE_NAME);
  const r = await cache.match('/config.json');
  if (r) { const c = await r.json(); return c.gasUrl; }
  return null;
}
