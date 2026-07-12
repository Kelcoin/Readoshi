import { getSyncToken, getWorkerUrl } from './worker-config';

const LOCAL_HISTORY_KEY = 'lrr_history';
const LOCAL_HIDE_READ_KEY = 'lrr_hide_read';
const REMOTE_HISTORY_CACHE_KEY = 'lrr_history_remote_cache';
const REMOTE_HIDE_READ_CACHE_KEY = 'lrr_hide_read_remote_cache';
const CROP_COVER_KEY = 'lrr_crop_cover';
const ARCHIVE_BROWSE_MODE_KEY = 'lrr_archive_browse_mode';

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
  if (!item?.id) return null;
  return {
    ...item,
    page: Number(item.page) || 0,
    total: Number(item.total) || 0,
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
  localStorage.setItem(activeHistoryKey(), JSON.stringify(sortHistoryByTime(list)));
  if (notify) emitHistoryChanged();
}

function writeHideReadCache(v) {
  localStorage.setItem(activeHideReadKey(), v ? '1' : '0');
  emitHistoryChanged();
}

async function buildJsonRequest(payload) {
  const text = JSON.stringify(payload);
  const headers = { 'Content-Type': 'application/json' };
  if (text.length < 2048 || typeof CompressionStream === 'undefined') {
    return { headers, body: text };
  }

  try {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    const body = await new Response(stream).blob();
    return { headers: { ...headers, 'Content-Encoding': 'gzip' }, body };
  } catch {
    return { headers, body: text };
  }
}

async function workerJson(endpoint, { method = 'GET', body = null } = {}) {
  const cfg = remoteConfig();
  if (!cfg) throw new Error('未配置 Worker');
  const init = {
    method,
    headers: { 'x-sync-token': cfg.token },
  };
  if (body) {
    const req = await buildJsonRequest(body);
    init.headers = { ...init.headers, ...req.headers };
    init.body = req.body;
  }
  const res = await fetch(cfg.base + endpoint, init);
  if (!res.ok) throw new Error(`Worker Error: ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function archiveToHistoryItem(archive, page) {
  return {
    id: archive.arcid,
    title: archive.title,
    tags: archive.tags || '',
    page,
    total: archive.pagecount,
    time: Date.now(),
  };
}

export const getHistory = () => sortHistoryByTime(safeReadJson(activeHistoryKey(), []));

export async function loadHistoryState() {
  if (!hasRemoteHistory()) {
    return { histories: getHistory(), hideRead: getHideRead(), remote: false };
  }

  const data = await workerJson('/history');
  const histories = sortHistoryByTime(data?.histories || []);
  localStorage.setItem(REMOTE_HISTORY_CACHE_KEY, JSON.stringify(histories));
  localStorage.setItem(REMOTE_HIDE_READ_CACHE_KEY, data?.hideRead ? '1' : '0');
  emitHistoryChanged();
  return { histories, hideRead: !!data?.hideRead, remote: true, retentionDays: data?.retentionDays || 0 };
}

export const saveHistory = async (archive, page) => {
  if (!archive?.arcid) return false;
  const item = archiveToHistoryItem(archive, page);
  const history = getHistory().filter((h) => h.id !== item.id);
  writeHistoryCache([...history, item]);

  if (!hasRemoteHistory()) return true;
  try {
    await workerJson('/history', { method: 'PUT', body: { history: item } });
    return true;
  } catch {
    return false;
  }
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
  const before = getHistory();
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
  const before = getHistory();
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
