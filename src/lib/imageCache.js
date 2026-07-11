// Two-tier image cache: memory (fast) + Cache API (persistent across reloads).
// On page reload after iOS process kill, images load from disk cache instantly
// instead of re-fetching from network.
const MEM_CACHE = new Map();
const MAX_MEM = 200;
const MAX_CONCURRENT = 3;
const DISK_CACHE = 'lrr-img-v3';
import { imageCacheIndex } from './imageCacheIndex.js';
import { resolveCacheLimit, selectCacheEvictions } from './cachePolicy.js';

const CACHE_MODE_KEY = 'lrr_image_cache_limit';

const pendingPromises = new Map();
let activeCount = 0;
const waitQueue = [];

function nextInQueue() {
  if (waitQueue.length === 0) return;
  const { resolve } = waitQueue.shift();
  resolve();
}

function acquireSlot() {
  if (activeCount < MAX_CONCURRENT) {
    activeCount++;
    return Promise.resolve();
  }
  return new Promise(resolve => { waitQueue.push({ resolve }); });
}

function releaseSlot() {
  activeCount--;
  nextInQueue();
}

// ── Disk cache helpers ──
function cacheKeyToUrl(key) {
  return `${location.origin}/__lrr_cache__/${encodeURIComponent(key)}`;
}

async function diskGet(key) {
  try {
    const r = await caches.match(new Request(cacheKeyToUrl(key)));
    if (!r) return null;
    const blob = await r.blob();
    imageCacheIndex.put({ key, size: blob.size, lastAccessedAt: Date.now() }).catch(() => {});
    return blob;
  } catch { return null; }
}

async function diskPut(key, blob) {
  try {
    const cache = await caches.open(DISK_CACHE);
    await cache.put(new Request(cacheKeyToUrl(key)), new Response(blob));
    await imageCacheIndex.put({ key, size: blob.size, createdAt: Date.now(), lastAccessedAt: Date.now() });
    enforceImageCacheLimit().catch(() => {});
  } catch {}
}

function rememberBlob(key, blob) {
  const objectUrl = URL.createObjectURL(blob);

  if (MEM_CACHE.size >= MAX_MEM) {
    const first = MEM_CACHE.keys().next().value;
    if (first) {
      const old = MEM_CACHE.get(first);
      if (old?.objectUrl) URL.revokeObjectURL(old.objectUrl);
      MEM_CACHE.delete(first);
    }
  }

  MEM_CACHE.set(key, { objectUrl, blob });
  return objectUrl;
}

export async function primeImage(key, fetcher) {
  if (!key || typeof fetcher !== 'function') return false;
  if (MEM_CACHE.has(key)) return true;

  const blob = await diskGet(key);
  if (blob) return true;

  try {
    const fetched = await fetcher();
    if (!fetched) return false;
    await diskPut(key, fetched);
    return true;
  } catch {
    return false;
  }
}

export async function getCachedImage(key) {
  if (MEM_CACHE.has(key)) {
    return MEM_CACHE.get(key).objectUrl;
  }
  const blob = await diskGet(key);
  if (!blob) return null;
  return rememberBlob(key, blob);
}

// ── Public API ──
export async function getImage(key, fetcher) {
  // 1. Memory cache (instant)
  if (MEM_CACHE.has(key)) {
    return MEM_CACHE.get(key).objectUrl;
  }

  // 2. Deduplicate in-flight requests
  if (pendingPromises.has(key)) {
    return pendingPromises.get(key);
  }

  const promise = (async () => {
    await acquireSlot();
    try {
      // Re-check memory (might have been filled while waiting)
      if (MEM_CACHE.has(key)) {
        return MEM_CACHE.get(key).objectUrl;
      }

      // 3. Disk cache (persists across reloads)
      let blob = await diskGet(key);

      // 4. Network fetch
      if (!blob) {
        try { blob = await fetcher(); } catch { return null; }
        if (!blob) return null;
        // Persist to disk (don't block)
        diskPut(key, blob).catch(() => {});
      }

      return rememberBlob(key, blob);
    } finally {
      releaseSlot();
      pendingPromises.delete(key);
    }
  })();

  pendingPromises.set(key, promise);
  return promise;
}

export async function clearImageCache({ disk = false } = {}) {
  for (const [, entry] of MEM_CACHE) {
    if (entry?.objectUrl) URL.revokeObjectURL(entry.objectUrl);
  }
  MEM_CACHE.clear();
  if (disk) {
    await Promise.all([caches.delete(DISK_CACHE), imageCacheIndex.clear()]);
  }
}

export async function getImageCacheStats() {
  const entries = await imageCacheIndex.all();
  const estimate = typeof navigator !== 'undefined' && navigator.storage?.estimate ? await navigator.storage.estimate() : {};
  const mode = typeof localStorage !== 'undefined' ? (localStorage.getItem(CACHE_MODE_KEY) || 'auto') : 'auto';
  return { mode, bytes: entries.reduce((sum, entry) => sum + (entry.size || 0), 0), limit: resolveCacheLimit(mode, estimate.quota), entries: entries.length };
}

export function setImageCacheLimit(mode) {
  if (typeof localStorage !== 'undefined') localStorage.setItem(CACHE_MODE_KEY, mode);
  return enforceImageCacheLimit();
}

export async function enforceImageCacheLimit(protectedKeys = new Set()) {
  const stats = await getImageCacheStats();
  const entries = await imageCacheIndex.all();
  const victims = selectCacheEvictions(entries, stats.limit, protectedKeys);
  if (!victims.length) return { ...stats, removed: 0 };
  const cache = await caches.open(DISK_CACHE);
  for (const entry of victims) {
    await cache.delete(new Request(cacheKeyToUrl(entry.key)));
    await imageCacheIndex.delete(entry.key);
  }
  return { ...stats, removed: victims.length };
}
