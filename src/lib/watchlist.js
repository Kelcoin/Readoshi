import { getSyncToken, getWorkerUrl } from './worker-config';
import { decorateArchiveRecord, hydrateArchiveRecords, rememberArchiveMetadata } from './archiveMetadataCache';

const LOCAL_WATCHLIST_KEY = 'lrr_watchlist';
const REMOTE_WATCHLIST_CACHE_KEY = 'lrr_watchlist_remote_cache';
const REMOTE_LOAD_TTL_MS = 30 * 1000;

let remoteLoadPromise = null;
let remoteLoadPromiseScope = '';
let remoteLoadedAt = 0;
let remoteLoadedScope = '';

function remoteConfig() {
  const workerUrl = getWorkerUrl();
  const token = getSyncToken();
  if (!workerUrl || !token) return null;
  return { base: workerUrl.replace(/\/$/, ''), token };
}

export function hasRemoteWatchlist() {
  return !!remoteConfig();
}

function safeReadJson(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '');
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function emitWatchlistChanged() {
  window.dispatchEvent(new CustomEvent('lrr:watchlist-changed'));
}

function activeWatchlistKey() {
  return hasRemoteWatchlist() ? REMOTE_WATCHLIST_CACHE_KEY : LOCAL_WATCHLIST_KEY;
}

function normalizeWatchlistItem(item) {
  const id = String(item?.id || item?.arcid || '').trim();
  if (!id) return null;
  return {
    id,
    addedAt: Number(item.addedAt) || Date.now(),
  };
}

function sortWatchlist(list) {
  return (Array.isArray(list) ? list : [])
    .map(normalizeWatchlistItem)
    .filter(Boolean)
    .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
}

function writeWatchlistCache(list, { notify = true } = {}) {
  localStorage.setItem(activeWatchlistKey(), JSON.stringify(sortWatchlist(list)));
  if (notify) emitWatchlistChanged();
}

async function workerJson(endpoint, { method = 'GET', body = null } = {}) {
  const cfg = remoteConfig();
  if (!cfg) throw new Error('未配置 Worker');
  const init = {
    method,
    headers: { 'x-sync-token': cfg.token },
  };
  if (body) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(cfg.base + endpoint, init);
  if (!res.ok) throw new Error(`Worker Error: ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function getStoredWatchlist() {
  return sortWatchlist(safeReadJson(activeWatchlistKey(), []));
}

export const getWatchlist = () => getStoredWatchlist().map(decorateArchiveRecord).filter(Boolean);

async function loadWatchlistStateNow({ force = false } = {}) {
  const remote = hasRemoteWatchlist();
  const cfg = remote ? remoteConfig() : null;
  const scope = cfg ? `${cfg.base}|${cfg.token}` : '';
  let items;
  let lastSync = 0;
  if (remote && (force || remoteLoadedScope !== scope || !remoteLoadedAt || Date.now() - remoteLoadedAt >= REMOTE_LOAD_TTL_MS)) {
    const data = await workerJson('/watchlist');
    items = sortWatchlist(data?.items || []);
    lastSync = data?.lastSync || 0;
    localStorage.setItem(REMOTE_WATCHLIST_CACHE_KEY, JSON.stringify(items));
    remoteLoadedAt = Date.now();
    remoteLoadedScope = scope;
  } else {
    items = getStoredWatchlist();
    writeWatchlistCache(items, { notify: false });
  }
  const hydrated = await hydrateArchiveRecords(items);
  if (hydrated.missingIds.length > 0) await removeWatchlistItems(hydrated.missingIds);
  emitWatchlistChanged();
  return { items: hydrated.items, remote, lastSync };
}

export function loadWatchlistState(options = {}) {
  const remote = hasRemoteWatchlist();
  const cfg = remote ? remoteConfig() : null;
  const scope = cfg ? `${cfg.base}|${cfg.token}` : '';
  if (remote && !options.force && remoteLoadPromise && remoteLoadPromiseScope === scope) return remoteLoadPromise;
  const task = loadWatchlistStateNow(options);
  if (!remote) return task;
  remoteLoadPromiseScope = scope;
  const trackedPromise = task.finally(() => {
    if (remoteLoadPromise !== trackedPromise) return;
    remoteLoadPromise = null;
    remoteLoadPromiseScope = '';
  });
  remoteLoadPromise = trackedPromise;
  return trackedPromise;
}

export const addWatchlistItem = async (archive) => {
  rememberArchiveMetadata(archive);
  const item = normalizeWatchlistItem(archive);
  if (!item) return false;
  item.addedAt = Date.now();
  const next = getStoredWatchlist().filter((entry) => entry.id !== item.id);
  writeWatchlistCache([item, ...next]);
  if (!hasRemoteWatchlist()) return true;
  try {
    await workerJson('/watchlist', { method: 'PUT', body: { item } });
    return true;
  } catch {
    return false;
  }
};

export const removeWatchlistItems = async (archiveIds) => {
  const removeSet = new Set((Array.isArray(archiveIds) ? archiveIds : []).map(String).filter(Boolean));
  if (removeSet.size === 0) return 0;
  const before = getStoredWatchlist();
  const next = before.filter((item) => !removeSet.has(item.id));
  const removed = before.length - next.length;
  if (removed === 0) return 0;
  writeWatchlistCache(next);
  if (hasRemoteWatchlist()) {
    try {
      await workerJson('/watchlist', { method: 'DELETE', body: { ids: Array.from(removeSet) } });
    } catch {}
  }
  return removed;
};

export const removeWatchlistItem = async (archiveId) => removeWatchlistItems([archiveId]);
