import { getSyncToken, getWorkerUrl } from './worker-config';
import { decorateArchiveRecord, hydrateArchiveRecords, rememberArchiveMetadata } from './archiveMetadataCache';
import { loadServerInfo } from './serverInfoCache';
import { mergeCachedHistoryProgress, mergeHistoryProgressCache, mergeMonotonicHistoryItems } from './historyProgressCache';

const LOCAL_HISTORY_KEY = 'lrr_history';
const LOCAL_HIDE_READ_KEY = 'lrr_hide_read';
const REMOTE_HISTORY_CACHE_KEY = 'lrr_history_remote_cache';
const REMOTE_HIDE_READ_CACHE_KEY = 'lrr_hide_read_remote_cache';
const HISTORY_PROGRESS_CACHE_KEY = 'lrr_history_progress_cache';
const CROP_COVER_KEY = 'lrr_crop_cover';
const ARCHIVE_BROWSE_MODE_KEY = 'lrr_archive_browse_mode';
const REMOTE_LOAD_TTL_MS = 30 * 1000;
const HISTORY_SYNC_INTERVAL_MS = 8 * 1000;
const HISTORY_SYNC_RETRY_MS = 2 * 60 * 1000;

let remoteLoadPromise = null;
let remoteLoadPromiseScope = '';
let remoteLoadedAt = 0;
let remoteLoadedScope = '';
let historyFlushTimer = null;
let historyFlushPromise = null;
let pendingHistoryScope = '';
const pendingHistorySync = new Map();

function remoteConfig() {
  const workerUrl = getWorkerUrl();
  const token = getSyncToken();
  if (!workerUrl || !token) return null;
  return { base: workerUrl.replace(/\/$/, ''), token };
}

export function hasRemoteHistory() {
  return !!remoteConfig();
}

function normalizeHistoryItem(item) {
  const id = String(item?.id || item?.arcid || '').trim();
  if (!id) return null;
  return {
    id,
    page: Number(item.page) || 0,
    time: Number(item.time) || 0,
  };
}

function sortHistoryByTime(list) {
  return (Array.isArray(list) ? list : [])
    .map(normalizeHistoryItem)
    .filter(Boolean)
    .sort((a, b) => (b.time || 0) - (a.time || 0));
}

function safeReadJson(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '');
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function emitHistoryChanged() {
  window.dispatchEvent(new CustomEvent('lrr:history-changed'));
}

function activeHistoryKey() {
  return hasRemoteHistory() ? REMOTE_HISTORY_CACHE_KEY : LOCAL_HISTORY_KEY;
}

function activeHideReadKey() {
  return hasRemoteHistory() ? REMOTE_HIDE_READ_CACHE_KEY : LOCAL_HIDE_READ_KEY;
}

function writeHistoryCache(list, { notify = true } = {}) {
  const histories = sortHistoryByTime(list);
  localStorage.setItem(activeHistoryKey(), JSON.stringify(histories));
  writeHistoryProgressCache(histories);
  if (notify) emitHistoryChanged();
}

function readHistoryProgressCache() {
  return safeReadJson(HISTORY_PROGRESS_CACHE_KEY, {});
}

function writeHistoryProgressCache(items) {
  const merged = mergeHistoryProgressCache(readHistoryProgressCache(), items);
  const entries = Object.entries(merged)
    .sort(([, a], [, b]) => (b.time || 0) - (a.time || 0))
    .slice(0, 500);
  localStorage.setItem(HISTORY_PROGRESS_CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
}

function writeHideReadCache(v) {
  localStorage.setItem(activeHideReadKey(), v ? '1' : '0');
  emitHistoryChanged();
}

async function workerJson(endpoint, { method = 'GET', body = null, keepalive = false } = {}) {
  const cfg = remoteConfig();
  if (!cfg) throw new Error('未配置 Worker');
  const init = {
    method,
    headers: { 'x-sync-token': cfg.token },
    keepalive,
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

function scheduleHistoryFlush(delay = HISTORY_SYNC_INTERVAL_MS) {
  if (historyFlushTimer) return;
  historyFlushTimer = setTimeout(() => {
    historyFlushTimer = null;
    flushHistorySync().catch(() => {});
  }, delay);
}

function queueHistorySync(item) {
  const cfg = remoteConfig();
  if (!cfg) return;
  const scope = `${cfg.base}|${cfg.token}`;
  if (pendingHistoryScope && pendingHistoryScope !== scope) pendingHistorySync.clear();
  pendingHistoryScope = scope;
  const queued = pendingHistorySync.get(item.id);
  pendingHistorySync.set(item.id, mergeMonotonicHistoryItems(queued ? [queued] : [], [item])[0]);
  scheduleHistoryFlush();
}

export async function flushHistorySync({ keepalive = false } = {}) {
  const cfg = remoteConfig();
  const scope = cfg ? `${cfg.base}|${cfg.token}` : '';
  if (!cfg || (pendingHistoryScope && pendingHistoryScope !== scope)) {
    pendingHistorySync.clear();
    pendingHistoryScope = '';
    if (historyFlushTimer) clearTimeout(historyFlushTimer);
    historyFlushTimer = null;
    return true;
  }
  if (pendingHistorySync.size === 0) return true;
  if (historyFlushPromise) return historyFlushPromise;
  if (historyFlushTimer) {
    clearTimeout(historyFlushTimer);
    historyFlushTimer = null;
  }

  const batch = Array.from(pendingHistorySync.values());
  batch.forEach((item) => pendingHistorySync.delete(item.id));
  historyFlushPromise = workerJson('/history', { method: 'PUT', body: { histories: batch }, keepalive })
    .then(() => true)
    .catch(() => {
      batch.forEach((item) => {
        const queued = pendingHistorySync.get(item.id);
        pendingHistorySync.set(item.id, mergeMonotonicHistoryItems(queued ? [queued] : [], [item])[0]);
      });
      scheduleHistoryFlush(HISTORY_SYNC_RETRY_MS);
      return false;
    })
    .finally(() => {
      historyFlushPromise = null;
      if (pendingHistorySync.size === 0) pendingHistoryScope = '';
      if (pendingHistorySync.size > 0 && !historyFlushTimer) scheduleHistoryFlush();
    });
  return historyFlushPromise;
}

function archiveToHistoryItem(archive, page) {
  rememberArchiveMetadata(archive);
  return {
    id: archive.arcid,
    page,
    time: Date.now(),
  };
}

function getStoredHistory() {
  const histories = sortHistoryByTime(safeReadJson(activeHistoryKey(), []));
  return mergeCachedHistoryProgress(histories, readHistoryProgressCache());
}

export const getHistory = () => getStoredHistory().map(decorateArchiveRecord).filter(Boolean);

async function loadHistoryStateNow({ force = false } = {}) {
  const remote = hasRemoteHistory();
  const cfg = remote ? remoteConfig() : null;
  const scope = cfg ? `${cfg.base}|${cfg.token}` : '';
  let histories;
  let hideRead;
  let retentionDays = 0;

  if (remote && (force || remoteLoadedScope !== scope || !remoteLoadedAt || Date.now() - remoteLoadedAt >= REMOTE_LOAD_TTL_MS)) {
    await flushHistorySync();
    const data = await workerJson('/history');
    const remoteHistories = sortHistoryByTime(data?.histories || []);
    histories = mergeCachedHistoryProgress(
      mergeMonotonicHistoryItems(remoteHistories, getStoredHistory()),
      readHistoryProgressCache(),
    );
    hideRead = !!data?.hideRead;
    retentionDays = data?.retentionDays || 0;
    localStorage.setItem(REMOTE_HISTORY_CACHE_KEY, JSON.stringify(histories));
    localStorage.setItem(REMOTE_HIDE_READ_CACHE_KEY, hideRead ? '1' : '0');
    remoteLoadedAt = Date.now();
    remoteLoadedScope = scope;
  } else {
    histories = getStoredHistory();
    hideRead = getHideRead();
    writeHistoryCache(histories, { notify: false });
  }

  const hydrated = await hydrateArchiveRecords(histories, { force });
  if (hydrated.missingIds.length > 0) await pruneHistoryItems(hydrated.missingIds);
  let resultItems = hydrated.items;
  try {
    const serverInfo = await loadServerInfo({ forceRefresh: force });
    if (serverInfo?.server_tracks_progress === true) {
      const storedById = new Map(histories.map((item) => [item.id, item]));
      const changed = [];
      resultItems = hydrated.items.map((item) => {
        if (item.progress === undefined || item.progress === null || item.progress === '') return item;
        const lrrProgress = Math.max(0, Number.parseInt(item.progress, 10) || 0);
        const stored = storedById.get(item.id);
        const nextPage = Math.max(stored?.page || 0, lrrProgress);
        if (!stored || stored.page === nextPage) return { ...item, page: nextPage };
        const next = { id: item.id, page: nextPage, time: stored.time };
        changed.push(next);
        return { ...item, page: nextPage };
      });
      if (changed.length > 0) {
        const changedById = new Map(changed.map((item) => [item.id, item]));
        const reconciled = histories.map((item) => changedById.get(item.id) || item);
        writeHistoryCache(reconciled, { notify: false });
        if (remote) await workerJson('/history', { method: 'PUT', body: { histories: changed } }).catch(() => {});
      }
    }
  } catch {}
  writeHistoryProgressCache(resultItems);
  emitHistoryChanged();
  return { histories: resultItems, hideRead, remote, retentionDays };
}

export function loadHistoryState(options = {}) {
  const remote = hasRemoteHistory();
  const cfg = remote ? remoteConfig() : null;
  const scope = cfg ? `${cfg.base}|${cfg.token}` : '';
  if (remote && !options.force && remoteLoadPromise && remoteLoadPromiseScope === scope) return remoteLoadPromise;
  const task = loadHistoryStateNow(options);
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

export const saveHistory = async (archive, page) => {
  if (!archive?.arcid) return false;
  const item = archiveToHistoryItem(archive, page);
  const history = mergeMonotonicHistoryItems(getStoredHistory(), [item]);
  writeHistoryCache(history);

  if (!hasRemoteHistory()) return true;
  queueHistorySync(history.find((entry) => entry.id === item.id));
  return true;
};

export const getHideRead = () => localStorage.getItem(activeHideReadKey()) === '1';

export const setHideRead = async (v) => {
  writeHideReadCache(v);
  if (!hasRemoteHistory()) return true;
  try {
    await workerJson('/history', { method: 'PUT', body: { hideRead: !!v } });
    return true;
  } catch {
    return false;
  }
};

export const replaceAllHistory = async (list) => {
  const histories = sortHistoryByTime(list);
  writeHistoryCache(histories);
  if (!hasRemoteHistory()) return true;
  try {
    await workerJson('/history', { method: 'PUT', body: { histories } });
    return true;
  } catch {
    return false;
  }
};

export const removeHistoryItems = async (archiveIds) => {
  const removeSet = new Set((Array.isArray(archiveIds) ? archiveIds : []).filter(Boolean));
  if (removeSet.size === 0) return 0;
  const before = getStoredHistory();
  const next = before.filter((item) => !removeSet.has(item.id));
  const removed = before.length - next.length;
  if (removed === 0) return 0;

  writeHistoryCache(next);
  if (!hasRemoteHistory()) return removed;
  try {
    await workerJson('/history', { method: 'DELETE', body: { ids: Array.from(removeSet) } });
  } catch {}
  return removed;
};

export const removeHistoryItem = async (archiveId) => removeHistoryItems([archiveId]);

export const pruneHistoryItems = async (archiveIds) => {
  const removeSet = new Set((Array.isArray(archiveIds) ? archiveIds : []).filter(Boolean));
  if (removeSet.size === 0) return 0;
  const before = getStoredHistory();
  const next = before.filter((item) => !removeSet.has(item.id));
  const removed = before.length - next.length;
  if (removed === 0) return 0;

  writeHistoryCache(next);
  if (hasRemoteHistory()) {
    try {
      await workerJson('/history', { method: 'DELETE', body: { ids: Array.from(removeSet) } });
    } catch {}
  }
  return removed;
};

export const getCropCover = () => localStorage.getItem(CROP_COVER_KEY) !== '0';

export const setCropCover = (v) => {
  localStorage.setItem(CROP_COVER_KEY, v ? '1' : '0');
};

export const getArchiveBrowseMode = () => localStorage.getItem(ARCHIVE_BROWSE_MODE_KEY) === 'paged' ? 'paged' : 'scroll';

export const setArchiveBrowseMode = (mode) => {
  localStorage.setItem(ARCHIVE_BROWSE_MODE_KEY, mode === 'paged' ? 'paged' : 'scroll');
};

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { flushHistorySync({ keepalive: true }).catch(() => {}); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushHistorySync({ keepalive: true }).catch(() => {});
  });
}
