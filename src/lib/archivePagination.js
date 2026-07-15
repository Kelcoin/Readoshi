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

export function getSmartArchivePageSize({ columns = 1, rows = 0, preferred = ARCHIVE_PAGE_SIZE, minimum = 1 } = {}) {
  const safeColumns = Math.max(1, Math.floor(Number(columns) || 1));
  const safeMinimum = Math.max(1, Math.floor(Number(minimum) || 1));
  const safePreferred = Math.max(safeColumns, Math.floor(Number(preferred) || ARCHIVE_PAGE_SIZE));
  const byRows = Math.floor(Number(rows) || 0) * safeColumns;
  if (byRows > 0) return Math.max(safeMinimum, byRows);
  return Math.max(safeMinimum, safeColumns, Math.ceil(safePreferred / safeColumns) * safeColumns);
}

export function getArchivePageAfterResize(page, oldSize, newSize) {
  const safeNewSize = Math.max(1, Math.floor(Number(newSize) || 1));
  return Math.floor(getArchivePageStart(page, oldSize) / safeNewSize);
}

export function getLastArchiveRowCentering(containerRect, itemRects, tolerance = 2) {
  if (!containerRect || !Array.isArray(itemRects) || itemRects.length === 0) {
    return { indexes: [], offset: 0, translations: [] };
  }
  const usableItems = itemRects
    .map((rect, index) => ({ rect, index }))
    .filter(({ rect }) => rect && Number.isFinite(rect.top) && Number.isFinite(rect.left) && Number.isFinite(rect.right));
  if (usableItems.length === 0) return { indexes: [], offset: 0, translations: [] };

  const containerCenter = containerRect.left + containerRect.width / 2;
  const rows = [];
  usableItems.forEach((item) => {
    const row = rows.find((candidate) => Math.abs(candidate.top - item.rect.top) <= tolerance);
    if (row) row.items.push(item);
    else rows.push({ top: item.rect.top, items: [item] });
  });
  rows.sort((a, b) => a.top - b.top);

  const lastRow = rows.at(-1).items;
  const rowsToCenter = [lastRow];
  if (lastRow.length === 1 && lastRow[0].rect.isWide) {
    for (let index = rows.length - 2; index >= 0; index--) {
      const row = rows[index].items;
      if (row.length !== 1 || !row[0].rect.isWide) break;
      rowsToCenter.unshift(row);
    }
  }

  const translations = rowsToCenter.flatMap((row) => {
    const groupLeft = Math.min(...row.map(({ rect }) => rect.left));
    const groupRight = Math.max(...row.map(({ rect }) => rect.right));
    const offset = Math.round(containerCenter - (groupLeft + groupRight) / 2);
    return row.map(({ index }) => ({ index, offset }));
  });
  const lastOffset = translations.at(-1)?.offset || 0;

  return {
    indexes: lastRow.map(({ index }) => index),
    offset: lastOffset,
    translations,
  };
}

export function observeLastArchiveRowCentering(grid) {
  if (!grid) return () => {};

  let frame = 0;
  const centerLastRow = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const items = Array.from(grid.children);
      items.forEach((item) => { item.style.translate = ''; });
      const { translations } = getLastArchiveRowCentering(
        grid.getBoundingClientRect(),
        items.map((item) => {
          const rect = item.getBoundingClientRect();
          return {
            left: rect.left,
            right: rect.right,
            top: rect.top,
            isWide: item.classList.contains('is-wide'),
          };
        }),
      );
      translations.forEach(({ index, offset }) => {
        if (Math.abs(offset) >= 1) items[index].style.translate = `${offset}px 0`;
      });
    });
  };

  const resizeObserver = new ResizeObserver(centerLastRow);
  const mutationObserver = new MutationObserver((records) => {
    if (records.some((record) => record.type === 'childList' && record.target === grid)) {
      mutationObserver.disconnect();
      mutationObserver.observe(grid, { childList: true });
      Array.from(grid.children).forEach((item) => {
        mutationObserver.observe(item, { attributes: true, attributeFilter: ['class'] });
      });
    }
    centerLastRow();
  });

  resizeObserver.observe(grid);
  mutationObserver.observe(grid, { childList: true });
  Array.from(grid.children).forEach((item) => {
    mutationObserver.observe(item, { attributes: true, attributeFilter: ['class'] });
  });
  window.addEventListener('resize', centerLastRow);
  centerLastRow();

  return () => {
    cancelAnimationFrame(frame);
    resizeObserver.disconnect();
    mutationObserver.disconnect();
    window.removeEventListener('resize', centerLastRow);
    Array.from(grid.children).forEach((item) => { item.style.translate = ''; });
  };
}
