import { normalizeReadingProgress } from './readingProgress.js';

function normalizedHistoryItem(item) {
  const id = String(item?.id || item?.arcid || '').trim();
  if (!id) return null;
  const progress = normalizeReadingProgress(item);
  return { id, page: progress.page, time: progress.time };
}

export function clampProgressPage(page, total) {
  const normalizedPage = Math.max(0, Number.parseInt(page, 10) || 0);
  const normalizedTotal = Math.max(0, Number.parseInt(total, 10) || 0);
  return normalizedTotal > 0 ? Math.min(normalizedPage, normalizedTotal) : normalizedPage;
}

export function mergeMonotonicHistoryItems(...lists) {
  const byId = new Map();
  for (const item of lists.flatMap((list) => (Array.isArray(list) ? list : []))) {
    const id = String(item?.id || item?.arcid || '').trim();
    if (!id) continue;
    const current = byId.get(id) || { id, page: 0, time: 0 };
    byId.set(id, {
      id,
      page: Math.max(current.page, Math.max(0, Number.parseInt(item.page, 10) || 0)),
      time: Math.max(current.time, Math.max(0, Number(item.time) || 0)),
    });
  }
  return Array.from(byId.values()).sort((a, b) => b.time - a.time);
}

export function mergeLatestHistoryItems(...lists) {
  const byId = new Map();
  for (const item of lists.flatMap((list) => (Array.isArray(list) ? list : []))) {
    const incoming = normalizedHistoryItem(item);
    if (!incoming) continue;
    const current = byId.get(incoming.id);
    if (!current || incoming.time >= current.time) byId.set(incoming.id, incoming);
  }
  return Array.from(byId.values()).sort((a, b) => b.time - a.time);
}
