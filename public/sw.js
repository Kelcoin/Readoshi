// Each build registers /sw.js with a unique version query. The version is also
// part of the cache name, so code from different deployments can never mix.
const BUILD_VERSION = new URL(self.location.href).searchParams.get('v') || 'legacy-v4';
const CACHE_PREFIX = 'lrr-shell-';
const CACHE = `${CACHE_PREFIX}${BUILD_VERSION}`;
const APP_SHELL = '/index.html';
const STATIC_ASSETS = [APP_SHELL, '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.allSettled(
        STATIC_ASSETS.map(async (asset) => {
          const response = await fetch(asset, { cache: 'no-cache' });
          if (isCacheableResponse(response)) {
            await safeCachePut(cache, asset, response);
          }
        })
      )
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) =>
        Promise.all(keys.filter((key) => (key.startsWith(CACHE_PREFIX) || key === 'lrr-shell-runtime-v3') && key !== CACHE).map((key) => caches.delete(key)))
      ),
      self.registration.navigationPreload
        ? self.registration.navigationPreload.enable().catch(() => {})
        : Promise.resolve(),
      self.clients.claim(),
    ])
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting());
  }
  if (event.data?.type === 'GET_VERSION') {
    event.source?.postMessage?.({ type: 'SW_VERSION', cache: CACHE });
  }
});

self.addEventListener('push', () => {});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('/');
      return undefined;
    })
  );
});

function isBypassRequest(request, url) {
  if (request.method !== 'GET') return true;
  if (url.origin !== self.location.origin) return true;
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/eh')) return true;
  if (url.pathname === '/sw.js') return true;
  if (request.destination === 'image') return true;
  return false;
}

function isCacheableResponse(response) {
  return response && response.ok && (response.type === 'basic' || response.type === 'default');
}

function offlineAppShellResponse() {
  return new Response(
    '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Readoshi</title></head><body style="margin:0;background:#181a20;color:#e3e9f3;font-family:system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px;box-sizing:border-box"><main style="max-width:360px;text-align:center"><h1 style="font-size:20px;margin:0 0 10px">离线状态</h1><p style="font-size:14px;line-height:1.6;color:#a7b1c2;margin:0">暂时无法连接，也没有可用的缓存页面。恢复网络后请重新打开 Readoshi。</p></main></body></html>',
    {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    }
  );
}

async function safeCachePut(cache, cacheKey, response) {
  try {
    await cache.put(cacheKey, response.clone());
  } catch {}
}

async function fetchAndCache(cache, request, cacheKey = request) {
  const response = await fetch(request, { cache: 'no-store' });
  if (isCacheableResponse(response)) {
    await safeCachePut(cache, cacheKey, response);
  }
  return response;
}

function fetchAppShell() {
  const networkRequest = new Request(APP_SHELL, { credentials: 'same-origin' });
  return caches.open(CACHE).then((cache) => fetchAndCache(cache, networkRequest, APP_SHELL));
}

async function navigationNetwork(event) {
  const preload = await event.preloadResponse;
  if (preload) return preload;
  return fetchAppShell();
}

function fetchStaticAsset(request) {
  return caches.open(CACHE).then((cache) => fetchAndCache(cache, request));
}

async function handleNavigation(network) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(APP_SHELL);
  try {
    return await network;
  } catch {
    return cached || offlineAppShellResponse();
  }
}

async function handleStaticAsset(request, network) {
  const cache = await caches.open(CACHE);

  if (new URL(request.url).pathname === APP_SHELL) {
    return handleNavigation(network);
  }

  const cached = await cache.match(request, { ignoreVary: true });
  try {
    return await network;
  } catch {
    return cached || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (isBypassRequest(event.request, url)) return;

  if (event.request.mode === 'navigate') {
    const network = navigationNetwork(event).then(async (response) => {
      if (isCacheableResponse(response)) {
        const cache = await caches.open(CACHE);
        await safeCachePut(cache, APP_SHELL, response);
      }
      return response;
    });
    event.waitUntil(network.catch(() => {}));
    event.respondWith(handleNavigation(network));
    return;
  }

  const network = fetchStaticAsset(event.request);
  event.waitUntil(network.catch(() => {}));
  event.respondWith(handleStaticAsset(event.request, network));
});
