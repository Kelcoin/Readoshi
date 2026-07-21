export function getArchiveAddedAt(archive) {
  const tagged = String(archive?.tags || '').match(/(?:^|,\s*)date_added:(\d+)/)?.[1];
  return Number(tagged || archive?.date_added || 0) || 0;
}

function archiveId(archive) {
  return String(archive?.arcid || archive?.id || '');
}

export function sortArchiveCatalog(items, sortBy = 'date_added', order = 'desc') {
  const direction = order === 'asc' ? 1 : -1;
  return [...(Array.isArray(items) ? items : [])].sort((a, b) => {
    const delta = sortBy === 'title'
      ? String(a?.title || '').localeCompare(String(b?.title || ''), undefined, { sensitivity: 'base' })
      : getArchiveAddedAt(a) - getArchiveAddedAt(b);
    return delta ? delta * direction : archiveId(a).localeCompare(archiveId(b));
  });
}

export function sliceArchiveCatalog(items, start, count) {
  const offset = Math.max(0, Math.floor(Number(start) || 0));
  const size = Math.max(0, Math.floor(Number(count) || 0));
  return (Array.isArray(items) ? items : []).slice(offset, offset + size);
}
