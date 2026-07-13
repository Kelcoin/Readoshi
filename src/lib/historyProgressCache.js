function normalizedProgressEntry(value) {
  const page = Math.max(0, Number.parseInt(value?.page, 10) || 0);
  const total = Math.max(0, Number.parseInt(value?.total ?? value?.pagecount, 10) || 0);
  const time = Math.max(0, Number(value?.time) || 0);
  return page > 0 ? { page, ...(total > 0 ? { total } : {}), time } : null;
}

export function mergeHistoryProgressCache(cache = {}, items = []) {
  const next = { ...cache };
  for (const item of Array.isArray(items) ? items : []) {
    const id = String(item?.id || item?.arcid || '').trim();
    const incoming = normalizedProgressEntry(item);
    if (!id || !incoming) continue;
    const current = normalizedProgressEntry(next[id]);
    if (!current || incoming.time > current.time || (incoming.time === current.time && (incoming.page > current.page || (incoming.total || 0) > (current.total || 0)))) {
      next[id] = incoming;
    }
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
    const withTotal = !total && cached.total ? { ...item, total: cached.total } : item;
    if (cached.time < time || (cached.time === time && cached.page <= page)) return withTotal;
    return { ...withTotal, page: cached.page };
  });
}
