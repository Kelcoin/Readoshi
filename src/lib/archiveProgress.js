import { scopedStorageKey } from './configScope.js';

const CLEARED_PROGRESS_KEY = 'lrr_reader_cleared_progress_v1';

function readClearedProgressIds(storage, key) {
  try {
    const parsed = JSON.parse(storage?.getItem(key) || '[]');
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

function getClearedProgressKey(key) {
  return key || scopedStorageKey(CLEARED_PROGRESS_KEY);
}

export function hasArchiveProgressMarker(id, storage = globalThis.localStorage, key = '') {
  return !!id && readClearedProgressIds(storage, getClearedProgressKey(key)).has(String(id));
}

export function markArchiveProgressCleared(id, storage = globalThis.localStorage, key = '') {
  if (!id) return;
  const storageKey = getClearedProgressKey(key);
  const ids = readClearedProgressIds(storage, storageKey);
  ids.add(String(id));
  try { storage?.setItem(storageKey, JSON.stringify([...ids])); } catch {}
}

export function clearArchiveProgressMarker(id, storage = globalThis.localStorage, key = '') {
  if (!id) return;
  const storageKey = getClearedProgressKey(key);
  const ids = readClearedProgressIds(storage, storageKey);
  ids.delete(String(id));
  try { storage?.setItem(storageKey, JSON.stringify([...ids])); } catch {}
}

export function shouldPersistArchiveReadingProgress(progressWasCleared, page) {
  return !progressWasCleared || (Number(page) || 0) > 1;
}

export const ARCHIVE_PROGRESS_VISIBILITY = Object.freeze({
  DISABLED: 'disabled',
  HISTORY: 'history',
  GLOBAL: 'global',
});

export function normalizeArchiveProgressVisibility(value) {
  return Object.values(ARCHIVE_PROGRESS_VISIBILITY).includes(value)
    ? value
    : ARCHIVE_PROGRESS_VISIBILITY.HISTORY;
}

export function shouldShowArchiveProgress(value, historicalContext = false) {
  const visibility = normalizeArchiveProgressVisibility(value);
  if (visibility === ARCHIVE_PROGRESS_VISIBILITY.DISABLED) return false;
  return visibility === ARCHIVE_PROGRESS_VISIBILITY.GLOBAL || historicalContext;
}

export function readArchiveProgressVisibility(storage = globalThis.localStorage) {
  try {
    const settings = JSON.parse(storage?.getItem('lrr_reader_settings') || '{}');
    return normalizeArchiveProgressVisibility(settings?.progressBarVisibility);
  } catch {
    return ARCHIVE_PROGRESS_VISIBILITY.HISTORY;
  }
}

export function getArchiveProgressPercent(archive = {}, options = {}) {
  const explicit = Number(options.progressPercent);
  if (options.progressPercent != null && Number.isFinite(explicit)) {
    return Math.max(0, Math.min(100, Math.round(explicit)));
  }

  const total = Number(options.totalPages ?? archive.pagecount ?? archive.total ?? 0);
  const current = Number(options.currentPage ?? archive.progress ?? archive.page ?? 0);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(current) || current <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((current / total) * 100)));
}

export function hasArchiveReadingProgress(archive = {}, localPage = 0) {
  archive ||= {};
  return Math.max(Number(archive.progress) || 0, Number(archive.page) || 0, Number(localPage) || 0) > 0;
}

export async function clearArchiveReadingProgress(archive, options = {}) {
  const id = archive?.arcid || archive?.id;
  if (!id) throw new Error('归档 ID 无效');
  const { api, removeHistory, saveHistoryEntry } = options;
  if (!api || !removeHistory || !saveHistoryEntry) throw new Error('缺少清除阅读进度所需服务');
  const info = await api.getServerInfo();
  if (info?.server_tracks_progress !== true) throw new Error('服务器未启用阅读进度');

  let fallback = false;
  try {
    await api.updateProgress(id, 0, { force: true });
  } catch {
    await api.updateProgress(id, 1);
    fallback = true;
  }
  if (fallback) {
    await saveHistoryEntry({ ...archive, arcid: id }, 1, { immediateRemote: true });
    return { page: 1, fallback: true };
  }
  await removeHistory(id);
  return { page: 0, fallback: false };
}
