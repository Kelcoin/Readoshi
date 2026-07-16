// Two-tier image cache: memory (fast) + Cache API (persistent across reloads).
// On page reload after iOS process kill, images load from disk cache instantly
// instead of re-fetching from network.
const MEM_CACHE = new Map();
const MAX_MEM = 200;
const DISK_CACHE = 'lrr-img-v3';
import { imageCacheIndex } from './imageCacheIndex.js';
import { resolveCacheLimit, selectCacheEvictions } from './cachePolicy.js';
import { createImageLoadQueue, IMAGE_LOAD_PRIORITY } from './imageLoadQueue.js';
import { getConfigScopeId, scopedCacheKey } from './configScope.js';

export { IMAGE_LOAD_PRIORITY } from './imageLoadQueue.js';

const CACHE_MODE_KEY = 'lrr_image_cache_limit';

const lastIndexTouch = new Map();
const INDEX_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
let cleanupTimer = null;
let diskCachePromise = null;
const retiredObjectUrlTimers = new Map();
const imageLoadQueue = createImageLoadQueue({ maxConcurrent: 3 });
const RETIRED_URL_GRACE_MS = 30 * 1000;
const MAX_RETIRED_URLS = 200;

function retireObjectUrl(objectUrl) {
  if (!objectUrl || retiredObjectUrlTimers.has(objectUrl)) return;
  const timer = setTimeout(() => {
    retiredObjectUrlTimers.delete(objectUrl);
    URL.revokeObjectURL(objectUrl);
  }, RETIRED_URL_GRACE_MS);
  retiredObjectUrlTimers.set(objectUrl, timer);
  while (retiredObjectUrlTimers.size > MAX_RETIRED_URLS) {
    const [oldestUrl, oldestTimer] = retiredObjectUrlTimers.entries().next().value;
    clearTimeout(oldestTimer);
    retiredObjectUrlTimers.delete(oldestUrl);
    URL.revokeObjectURL(oldestUrl);
  }
}

async function fetchForScope(fetcher, scope) {
  if (getConfigScopeId() !== scope) return null;
  const blob = await fetcher();
  return getConfigScopeId() === scope ? blob : null;
}

function getDiskCache() {
  if (!diskCachePromise) diskCachePromise = caches.open(DISK_CACHE);
  return diskCachePromise;
}

// ── Disk cache helpers ──
function cacheKeyToUrl(key) {
  return `${location.origin}/__lrr_cache__/${encodeURIComponent(key)}`;
}

async function diskGet(key) {
  try {
    const cache = await getDiskCache();
    const r = await cache.match(new Request(cacheKeyToUrl(key)));
    if (!r) return null;
    const blob = await r.blob();
    const now = Date.now();
    if (now - (lastIndexTouch.get(key) || 0) >= INDEX_TOUCH_INTERVAL_MS) {
      lastIndexTouch.set(key, now);
      imageCacheIndex.put({ key, size: blob.size, lastAccessedAt: now }).catch(() => {});
    }
    return blob;
  } catch { return null; }
}

async function diskPut(key, blob) {
  try {
    const cache = await getDiskCache();
    await cache.put(new Request(cacheKeyToUrl(key)), new Response(blob));
    await imageCacheIndex.put({ key, size: blob.size, createdAt: Date.now(), lastAccessedAt: Date.now() });
    if (cleanupTimer) clearTimeout(cleanupTimer);
    cleanupTimer = setTimeout(() => {
      cleanupTimer = null;
      enforceImageCacheLimit().catch(() => {});
    }, 2000);
  } catch {}
}

function rememberBlob(key, blob) {
  const objectUrl = URL.createObjectURL(blob);

  if (MEM_CACHE.size >= MAX_MEM) {
    const first = MEM_CACHE.keys().next().value;
    if (first) {
      const old = MEM_CACHE.get(first);
      if (old?.objectUrl) retireObjectUrl(old.objectUrl);
      MEM_CACHE.delete(first);
    }
  }

  MEM_CACHE.set(key, { objectUrl, blob });
  return objectUrl;
}

function scheduleImageLoad(key, fetcher, priority = IMAGE_LOAD_PRIORITY.NORMAL) {
  return imageLoadQueue.schedule(key, async () => {
    if (MEM_CACHE.has(key)) return MEM_CACHE.get(key).blob;
    let blob = await diskGet(key);
    if (!blob) {
      blob = await fetcher();
      if (!blob) return null;
      diskPut(key, blob).catch(() => {});
    }
    return blob;
  }, priority);
}

export async function primeImage(key, fetcher, { priority = IMAGE_LOAD_PRIORITY.PRELOAD } = {}) {
  if (!key || typeof fetcher !== 'function') return false;
  const scope = getConfigScopeId();
  key = scopedCacheKey(key);
  if (MEM_CACHE.has(key)) return true;
  try {
    return !!(await scheduleImageLoad(key, () => fetchForScope(fetcher, scope), priority));
  } catch {
    return false;
  }
}

export async function getCachedImage(key) {
  key = scopedCacheKey(key);
  if (MEM_CACHE.has(key)) {
    return MEM_CACHE.get(key).objectUrl;
  }
  const blob = await diskGet(key);
  if (!blob) return null;
  return rememberBlob(key, blob);
}

// ── Public API ──
export async function getImage(key, fetcher, { priority = IMAGE_LOAD_PRIORITY.NORMAL } = {}) {
  const scope = getConfigScopeId();
  key = scopedCacheKey(key);
  // 1. Memory cache (instant)
  if (MEM_CACHE.has(key)) {
    return MEM_CACHE.get(key).objectUrl;
  }

  let blob;
  try { blob = await scheduleImageLoad(key, () => fetchForScope(fetcher, scope), priority); } catch { return null; }
  if (!blob) return null;
  if (MEM_CACHE.has(key)) return MEM_CACHE.get(key).objectUrl;
  return rememberBlob(key, blob);
}

export async function clearImageCache({ disk = false } = {}) {
  for (const [, entry] of MEM_CACHE) {
    if (entry?.objectUrl) URL.revokeObjectURL(entry.objectUrl);
  }
  for (const [objectUrl, timer] of retiredObjectUrlTimers) {
    clearTimeout(timer);
    URL.revokeObjectURL(objectUrl);
  }
  retiredObjectUrlTimers.clear();
  MEM_CACHE.clear();
  lastIndexTouch.clear();
  if (cleanupTimer) { clearTimeout(cleanupTimer); cleanupTimer = null; }
  if (disk) {
    await Promise.all([caches.delete(DISK_CACHE), imageCacheIndex.clear()]);
    diskCachePromise = null;
  }
}

export async function deleteImageKeys(keys) {
  const scopedKeys = Array.from(new Set((Array.isArray(keys) ? keys : [keys])
    .filter(Boolean)
    .map((key) => scopedCacheKey(key))));
  if (scopedKeys.length === 0) return 0;
  const cache = await getDiskCache();
  await Promise.all(scopedKeys.map(async (key) => {
    const entry = MEM_CACHE.get(key);
    if (entry?.objectUrl) URL.revokeObjectURL(entry.objectUrl);
    MEM_CACHE.delete(key);
    lastIndexTouch.delete(key);
    await Promise.all([
      cache.delete(new Request(cacheKeyToUrl(key))),
      imageCacheIndex.delete(key),
    ]);
  }));
  return scopedKeys.length;
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
  const entries = await imageCacheIndex.all();
  const estimate = typeof navigator !== 'undefined' && navigator.storage?.estimate ? await navigator.storage.estimate() : {};
  const mode = typeof localStorage !== 'undefined' ? (localStorage.getItem(CACHE_MODE_KEY) || 'auto') : 'auto';
  const stats = { mode, bytes: entries.reduce((sum, entry) => sum + (entry.size || 0), 0), limit: resolveCacheLimit(mode, estimate.quota), entries: entries.length };
  const scopedProtectedKeys = new Set(Array.from(protectedKeys, (key) => scopedCacheKey(key)));
  const victims = selectCacheEvictions(entries, stats.limit, scopedProtectedKeys);
  if (!victims.length) return { ...stats, removed: 0 };
  const cache = await getDiskCache();
  for (const entry of victims) {
    await cache.delete(new Request(cacheKeyToUrl(entry.key)));
    await imageCacheIndex.delete(entry.key);
  }
  return { ...stats, removed: victims.length };
}
