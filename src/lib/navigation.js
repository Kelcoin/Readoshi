function dispatchRouteChange(detail) {
  window.dispatchEvent(new CustomEvent('lrr:navigate', { detail }));
}

export function parseRouteFromLocation() {
  const params = new URLSearchParams(window.location.search);
  const archiveId = params.get('id');
  const query = params.get('q');
  const view = params.get('view');

  if (archiveId) {
    return { kind: 'reader', archiveId };
  }
  if (view === 'history') {
    return { kind: 'history' };
  }

  return { kind: 'home', query: query || '' };
}

export function navigateToArchive(archiveId, { replace = false } = {}) {
  if (!archiveId) return;
  const url = `/?id=${encodeURIComponent(archiveId)}`;
  if (replace) window.history.replaceState({}, '', url);
  else window.history.pushState({}, '', url);
  dispatchRouteChange({ kind: 'reader', archiveId: String(archiveId) });
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
