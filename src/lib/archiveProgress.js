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
