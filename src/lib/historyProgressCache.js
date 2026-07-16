function normalizedProgressEntry(value) {
  const page = Math.max(0, Number.parseInt(value?.page, 10) || 0);
  const total = Math.max(0, Number.parseInt(value?.total ?? value?.pagecount, 10) || 0);
  const time = Math.max(0, Number(value?.time) || 0);
  return page > 0 ? { page, ...(total > 0 ? { total } : {}), time } : null;
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

export function mergeHistoryProgressCache(cache = {}, items = []) {
  const next = { ...cache };
  for (const item of Array.isArray(items) ? items : []) {
    const id = String(item?.id || item?.arcid || '').trim();
    const incoming = normalizedProgressEntry(item);
    if (!id || !incoming) continue;
    const current = normalizedProgressEntry(next[id]);
    next[id] = current
      ? {
          page: Math.max(current.page, incoming.page),
          ...(Math.max(current.total || 0, incoming.total || 0) > 0
            ? { total: Math.max(current.total || 0, incoming.total || 0) }
            : {}),
          time: Math.max(current.time, incoming.time),
        }
      : incoming;
  }
  return next;
}

export function mergeCachedHistoryProgress(items = [], cache = {}) {
  return (Array.isArray(items) ? items : []).map((item) => {
    const id = String(item?.id || item?.arcid || '').trim();
    const cached = normalizedProgressEntry(cache[id]);
    if (!id || !cached) return item;
    const page = Math.max(0, Number.parseInt(item?.page, 10) || 0);
    const time = Math.max(0, Number(item?.time) || 0);
    const total = Math.max(0, Number.parseInt(item?.total ?? item?.pagecount, 10) || 0);
    const nextTotal = Math.max(total, cached.total || 0);
    return {
      ...item,
      page: Math.max(page, cached.page),
      ...(nextTotal > 0 ? { total: nextTotal } : {}),
      time: Math.max(time, cached.time),
    };
  });
}
