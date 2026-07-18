export const READING_PROGRESS_CHANGED_EVENT = 'lrr:reading-progress-changed';

export function normalizeReadingProgress(value = {}) {
  const page = Math.max(0, Number.parseInt(value?.page, 10) || 0);
  const total = Math.max(0, Number.parseInt(value?.total ?? value?.pagecount, 10) || 0);
  const time = Math.max(0, Number(value?.time ?? value?.timestamp) || 0);
  return {
    page,
    ...(total > 0 ? { total } : {}),
    time,
    ...(value?.cleared === true ? { cleared: true } : {}),
  };
}

export function mergeReadingProgress(currentValue, incomingValue, { allowRegression = true } = {}) {
  const current = normalizeReadingProgress(currentValue);
  const incoming = normalizeReadingProgress(incomingValue);
  if (incoming.cleared) return incoming;

  const total = Math.max(current.total || 0, incoming.total || 0);
  if (!allowRegression) {
    return {
      page: Math.max(current.page, incoming.page),
      ...(total > 0 ? { total } : {}),
      time: Math.max(current.time, incoming.time),
    };
  }

  const selected = incoming.time >= current.time ? incoming : current;
  return {
    page: selected.page,
    ...(total > 0 ? { total } : {}),
    time: Math.max(current.time, incoming.time),
    ...(selected.cleared ? { cleared: true } : {}),
  };
}

export function dispatchReadingProgressChanged(detail) {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return;
  const archiveId = String(detail?.archiveId || detail?.id || detail?.arcid || '').trim();
  if (!archiveId) return;
  window.dispatchEvent(new CustomEvent(READING_PROGRESS_CHANGED_EVENT, {
    detail: { archiveId, ...normalizeReadingProgress(detail) },
  }));
}

export function subscribeReadingProgressChanged(listener) {
  if (typeof window === 'undefined' || typeof listener !== 'function') return () => {};
  const handler = (event) => listener(event.detail);
  window.addEventListener(READING_PROGRESS_CHANGED_EVENT, handler);
  return () => window.removeEventListener(READING_PROGRESS_CHANGED_EVENT, handler);
}

export function mergeWatchlistReadingProgress(items, histories) {
  const historyById = new Map((Array.isArray(histories) ? histories : []).map((item) => [
    String(item?.id || item?.arcid || ''),
    item,
  ]));
  return (Array.isArray(items) ? items : []).map((item) => {
    const history = historyById.get(String(item?.id || item?.arcid || ''));
    const page = history ? Math.max(0, Number(history.page) || 0) : Math.max(0, Number(item?.page) || 0);
    const total = Number(item?.total || item?.pagecount || history?.total || history?.pagecount) || 0;
    return { ...item, page, total };
  });
}
