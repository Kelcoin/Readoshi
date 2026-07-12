export const ARCHIVE_PAGE_SIZE = 50;
export const ARCHIVE_BROWSE_MODES = {
  scroll: 'scroll',
  paged: 'paged',
};

export function normalizeArchiveBrowseMode(value) {
  return value === ARCHIVE_BROWSE_MODES.paged ? ARCHIVE_BROWSE_MODES.paged : ARCHIVE_BROWSE_MODES.scroll;
}

export function getArchivePageCount(total, pageSize = ARCHIVE_PAGE_SIZE) {
  const count = Number(total);
  if (!Number.isFinite(count) || count <= 0) return 1;
  return Math.max(1, Math.ceil(count / pageSize));
}

export function clampArchivePage(page, total, pageSize = ARCHIVE_PAGE_SIZE) {
  const normalized = Math.max(0, Math.floor(Number(page) || 0));
  if (total === null || total === undefined || total === '' || !Number.isFinite(Number(total))) return normalized;
  return Math.min(normalized, getArchivePageCount(total, pageSize) - 1);
}

export function getArchivePageStart(page, pageSize = ARCHIVE_PAGE_SIZE) {
  return Math.max(0, Math.floor(Number(page) || 0)) * pageSize;
}
