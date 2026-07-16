export function getCacheUsagePercent(stats) {
  const bytes = Number(stats?.bytes) || 0;
  const limit = Number(stats?.limit) || 0;
  if (limit <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((bytes / limit) * 100)));
}
