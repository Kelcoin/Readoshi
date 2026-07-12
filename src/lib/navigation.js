function dispatchRouteChange(detail) {
  window.dispatchEvent(new CustomEvent('lrr:navigate', { detail }));
}

export function parseRouteSearch(search = '') {
  const params = new URLSearchParams(search);
  const archiveId = params.get('id');
  const query = params.get('q');
  const view = params.get('view');

  if (archiveId && view === 'metadata') return { kind: 'metadata', archiveId };

  if (archiveId) {
    return { kind: 'reader', archiveId };
  }
  if (view === 'history') {
    return { kind: 'history' };
  }
  if (view === 'watchlist') {
    return { kind: 'watchlist' };
  }
  if (view === 'dedupe') {
    return { kind: 'dedupe' };
  }
  if (view === 'upload') {
    return { kind: 'upload' };
  }

  return { kind: 'home', query: query || '' };
}

export function parseRouteFromLocation() {
  return parseRouteSearch(window.location.search);
}

export function navigateToArchive(archiveId, { replace = false } = {}) {
  if (!archiveId) return;
  const url = `/?id=${encodeURIComponent(archiveId)}`;
  if (replace) window.history.replaceState({}, '', url);
  else window.history.pushState({}, '', url);
  dispatchRouteChange({ kind: 'reader', archiveId: String(archiveId) });
}

export function navigateToMetadata(archiveId, { replace = false } = {}) {
  if (!archiveId) return;
  const url = `/?view=metadata&id=${encodeURIComponent(archiveId)}`;
  if (replace) window.history.replaceState({}, '', url);
  else window.history.pushState({}, '', url);
  dispatchRouteChange({ kind: 'metadata', archiveId: String(archiveId) });
}

export function navigateHome({ query = '', replace = false, scrollToArchives = false } = {}) {
  const nextQuery = (query || '').trim();
  const url = nextQuery ? `/?q=${encodeURIComponent(nextQuery)}` : '/';
  if (scrollToArchives) {
    try { sessionStorage.setItem('lrr_scroll_archives_on_arrival', '1'); } catch {}
  }
  if (replace) window.history.replaceState({}, '', url);
  else window.history.pushState({}, '', url);
  dispatchRouteChange({ kind: 'home', query: nextQuery, scrollToArchives });
}

export function navigateHistory({ replace = false } = {}) {
  const url = '/?view=history';
  if (replace) window.history.replaceState({}, '', url);
  else window.history.pushState({}, '', url);
  dispatchRouteChange({ kind: 'history' });
}

export function navigateWatchlist({ replace = false } = {}) {
  const url = '/?view=watchlist';
  if (replace) window.history.replaceState({}, '', url);
  else window.history.pushState({}, '', url);
  dispatchRouteChange({ kind: 'watchlist' });
}

export function navigateDeduplicate({ replace = false } = {}) {
  const url = '/?view=dedupe';
  if (replace) window.history.replaceState({}, '', url);
  else window.history.pushState({}, '', url);
  dispatchRouteChange({ kind: 'dedupe' });
}

export function navigateUpload({ replace = false } = {}) {
  const url = '/?view=upload';
  if (replace) window.history.replaceState({}, '', url);
  else window.history.pushState({}, '', url);
  dispatchRouteChange({ kind: 'upload' });
}
