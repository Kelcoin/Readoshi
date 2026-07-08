import { getWorkerUrl, getSyncToken } from './worker-config';

function readHistory() { try { return JSON.parse(localStorage.getItem('lrr_history') || '[]'); } catch { return []; } }
function readDeleted() { try { return JSON.parse(localStorage.getItem('lrr_history_deleted') || '[]'); } catch { return []; } }
function readHideRead() { return localStorage.getItem('lrr_hide_read') === '1'; }
function sortHistories(list) {
  return (Array.isArray(list) ? list : [])
    .filter((item) => item?.id)
    .map((item) => ({
      ...item,
      page: Number(item.page) || 0,
      total: Number(item.total) || 0,
      time: Number(item.time) || 0,
    }))
    .sort((a, b) => (b.time || 0) - (a.time || 0))
    .slice(0, 50);
}

function writeHistory(list) { localStorage.setItem('lrr_history', JSON.stringify(sortHistories(list))); }
function writeDeleted(list) { localStorage.setItem('lrr_history_deleted', JSON.stringify((list || []).slice(0, 200))); }
function writeHideRead(v) { localStorage.setItem('lrr_hide_read', v ? '1' : '0'); }

let pushInFlight = false;
let pendingPush = false;
let debounceTimer = null;
const DEBOUNCE_MS = 320;
const URGENT_DEBOUNCE_MS = 120;
const IMMEDIATE_PUSH_MIN_GAP_MS = 420;
let lastPushStartedAt = 0;
let syncNowInFlight = null;

export async function pullFromCloud() {
  const workerUrl = getWorkerUrl();
  const token = getSyncToken();
  if (!workerUrl || !token) return null;

  try {
    const res = await fetch(workerUrl.replace(/\/$/, '') + '/history', {
      headers: { 'x-sync-token': token },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function pushToCloud(histories, hideRead, deleted = []) {
  const workerUrl = getWorkerUrl();
  const token = getSyncToken();
  if (!workerUrl || !token) return false;

  try {
    const res = await fetch(workerUrl.replace(/\/$/, '') + '/history', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-sync-token': token },
      body: JSON.stringify({ histories, hideRead, deleted }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function mergeDeleted(localDeleted, cloudDeleted) {
  const merged = new Map();
  [...(Array.isArray(localDeleted) ? localDeleted : []), ...(Array.isArray(cloudDeleted) ? cloudDeleted : [])]
    .forEach((item) => {
      if (!item?.id) return;
      const prev = merged.get(item.id);
      if (!prev || (item.deletedAt || 0) > (prev.deletedAt || 0)) {
        merged.set(item.id, { id: item.id, deletedAt: item.deletedAt || Date.now() });
      }
    });
  return Array.from(merged.values())
    .sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0))
    .slice(0, 200);
}

function mergeHistories(localList, cloudData, deletedList = []) {
  if (!cloudData || !Array.isArray(cloudData.histories)) return localList;
  const deletedMap = new Map((deletedList || []).map((item) => [item.id, item.deletedAt || 0]));
  const merged = new Map();
  for (const h of localList) {
    if (!h?.id) continue;
    const deletedAt = deletedMap.get(h.id) || 0;
    if ((h.time || 0) > deletedAt) {
      merged.set(h.id, h);
    }
  }
  for (const h of cloudData.histories) {
    if (!h?.id) continue;
    const deletedAt = deletedMap.get(h.id) || 0;
    if ((h.time || 0) <= deletedAt) continue;
    const old = merged.get(h.id);
    if (!old || (h.time && h.time > (old.time || 0))) merged.set(h.id, h);
  }
  return sortHistories(Array.from(merged.values()));
}

function pruneDeleted(deletedList, histories) {
  const historyMap = new Map((Array.isArray(histories) ? histories : []).map((item) => [item.id, item.time || 0]));
  return (Array.isArray(deletedList) ? deletedList : [])
    .filter((item) => item?.id && (historyMap.get(item.id) || 0) <= (item.deletedAt || 0))
    .sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0))
    .slice(0, 200);
}

async function doPush() {
  if (pushInFlight) { pendingPush = true; return; }
  pushInFlight = true;
  pendingPush = false;
  lastPushStartedAt = Date.now();
  try {
    const histories = readHistory();
    const deleted = pruneDeleted(readDeleted(), histories);
    writeDeleted(deleted);
    await pushToCloud(histories, readHideRead(), deleted);
  } finally {
    pushInFlight = false;
    if (pendingPush) { pendingPush = false; setTimeout(doPush, 100); }
  }
}

export async function syncNow() {
  if (syncNowInFlight) return syncNowInFlight;
  syncNowInFlight = (async () => {
  const workerUrl = getWorkerUrl();
  const token = getSyncToken();
  if (!workerUrl || !token) return false;

  const cloudData = await pullFromCloud();
  const mergedDeleted = mergeDeleted(readDeleted(), cloudData?.deleted || []);
  const merged = mergeHistories(sortHistories(readHistory()), cloudData, mergedDeleted);
  const deleted = pruneDeleted(mergedDeleted, merged);
  writeHistory(merged);
  writeDeleted(deleted);

  if (cloudData && cloudData.hideRead !== undefined) {
    writeHideRead(cloudData.hideRead);
  }

  await pushToCloud(merged, readHideRead(), deleted);
  return true;
  })();

  try {
    return await syncNowInFlight;
  } finally {
    syncNowInFlight = null;
  }
}

export async function syncNowIfConfigured() {
  const workerUrl = getWorkerUrl();
  const token = getSyncToken();
  if (!workerUrl || !token) return false;
  return syncNow();
}

export function schedulePush({ urgent = false, immediate = false } = {}) {
  const workerUrl = getWorkerUrl();
  const token = getSyncToken();
  if (!workerUrl || !token) return;

  if (debounceTimer) clearTimeout(debounceTimer);
  if (immediate && pushInFlight) {
    pendingPush = true;
    return;
  }
  const now = Date.now();
  const canPushImmediately = immediate && (now - lastPushStartedAt >= IMMEDIATE_PUSH_MIN_GAP_MS);
  const wait = canPushImmediately ? 0 : ((urgent || immediate) ? URGENT_DEBOUNCE_MS : DEBOUNCE_MS);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void doPush();
  }, wait);
}
