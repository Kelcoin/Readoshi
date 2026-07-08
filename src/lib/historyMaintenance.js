import { lrrApi } from './api';
import { getHistory, hasRemoteHistory, loadHistoryState, pruneHistoryItems } from './history';
import { getSyncToken, getWorkerUrl } from './worker-config';

const HISTORY_EXISTENCE_CHECK_KEY = 'lrr_history_existence_checked_at';
const HISTORY_EXISTENCE_CHECK_INTERVAL_MS = 30 * 60 * 1000;
const HISTORY_EXISTENCE_CHECK_CONCURRENCY = 4;

let checkTimer = null;
let startupTimer = null;
let checkInFlight = null;

function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function currentHistoryScopeKey() {
  const serverUrl = (localStorage.getItem('lrr_server_url') || '').replace(/\/$/, '');
  const workerUrl = (getWorkerUrl() || '').replace(/\/$/, '');
  const syncToken = getSyncToken() || '';
  const historyMode = workerUrl && syncToken
    ? `remote:${workerUrl}:${hashString(syncToken)}`
    : 'local';
  return `${HISTORY_EXISTENCE_CHECK_KEY}:${hashString(`${serverUrl}|${historyMode}`)}`;
}

function readLastCheckedAt() {
  return Number(localStorage.getItem(currentHistoryScopeKey()) || 0) || 0;
}

function writeLastCheckedAt(time = Date.now()) {
  localStorage.setItem(currentHistoryScopeKey(), String(time));
}

export function isArchiveMissingError(err) {
  return err?.status === 400 || err?.status === 404;
}

async function validateHistoryItem(item) {
  if (!item?.id) return { id: '', missing: false, checked: false };
  try {
    await lrrApi.getArchive(item.id);
    return { id: item.id, missing: false, checked: true };
  } catch (err) {
    return { id: item.id, missing: isArchiveMissingError(err), checked: isArchiveMissingError(err) };
  }
}

async function validateInBatches(items) {
  const missingIds = [];
  let checkedCount = 0;
  for (let i = 0; i < items.length; i += HISTORY_EXISTENCE_CHECK_CONCURRENCY) {
    const batch = items.slice(i, i + HISTORY_EXISTENCE_CHECK_CONCURRENCY);
    const results = await Promise.all(batch.map(validateHistoryItem));
    results.forEach((result) => {
      if (result.checked) checkedCount += 1;
      if (result.missing && result.id) missingIds.push(result.id);
    });
  }
  return { missingIds, checkedCount };
}

export async function runHistoryExistenceCheck({ force = false } = {}) {
  if (checkInFlight) return checkInFlight;
  const now = Date.now();
  if (!force && now - readLastCheckedAt() < HISTORY_EXISTENCE_CHECK_INTERVAL_MS) return 0;

  checkInFlight = (async () => {
    const history = hasRemoteHistory()
      ? (await loadHistoryState().catch(() => ({ histories: getHistory() }))).histories
      : getHistory();
    if (history.length === 0) {
      writeLastCheckedAt();
      return 0;
    }

    const { missingIds, checkedCount } = await validateInBatches(history);
    const removed = await pruneHistoryItems(missingIds);
    if (checkedCount > 0) writeLastCheckedAt();
    return removed;
  })();

  try {
    return await checkInFlight;
  } finally {
    checkInFlight = null;
  }
}

export function startHistoryExistenceCheckTimer() {
  if (checkTimer) return;
  startupTimer = window.setTimeout(() => {
    startupTimer = null;
    runHistoryExistenceCheck({ force: true }).catch(() => {});
  }, 5000);
  checkTimer = window.setInterval(() => {
    runHistoryExistenceCheck({ force: true }).catch(() => {});
  }, HISTORY_EXISTENCE_CHECK_INTERVAL_MS);
}

export function stopHistoryExistenceCheckTimer() {
  if (startupTimer) {
    window.clearTimeout(startupTimer);
    startupTimer = null;
  }
  if (checkTimer) {
    window.clearInterval(checkTimer);
    checkTimer = null;
  }
}
