import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ArchiveCard from '../components/ArchiveCard';
import ArchiveContextMenu from '../components/ArchiveContextMenu';
import { navigateToMetadata } from '../lib/navigation';
import ConfirmDialog from '../components/ConfirmDialog';
import ArchiveSearchBox from '../components/ArchiveSearchBox';
import { HomeSectionGlyph, getSectionGlyphColor } from '../components/AppGlyphs';
import { getCropCover, getHistory, loadHistoryState } from '../lib/history';
import { lrrApi } from '../lib/api';
import { archiveMatchesSearch } from '../lib/archiveSearch';
import { getSyncToken, getWorkerUrl } from '../lib/worker-config';
import { getWatchlist, getWatchlistAutoRemoveIds, loadWatchlistState, mergeWatchlistProgress, removeWatchlistItems } from '../lib/watchlist';
import { ARCHIVE_PROGRESS_VISIBILITY, readArchiveProgressVisibility, shouldShowArchiveProgress } from '../lib/archiveProgress';
import { observeLastArchiveRowCentering } from '../lib/archivePagination';

function HeaderGlyph() {
  return <HomeSectionGlyph name="watchlist" size={24} color={getSectionGlyphColor('watchlist')} />;
}

export default function WatchlistPage({ onSelectArchive, onBack }) {
  const [items, setItems] = useState(() => getWatchlist());
  const [history, setHistory] = useState(() => getHistory());
  const [cropCover] = useState(getCropCover);
  const [progressBarVisibility] = useState(readArchiveProgressVisibility);
  const showHistoricalArchiveProgress = shouldShowArchiveProgress(progressBarVisibility, true);
  const reserveGlobalProgressSpace = progressBarVisibility === ARCHIVE_PROGRESS_VISIBILITY.GLOBAL;
  const [query, setQuery] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [lastSelectedId, setLastSelectedId] = useState(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [menu, setMenu] = useState(null);
  const [isNarrow, setIsNarrow] = useState(window.innerWidth < 600);
  const gridRef = useRef(null);

  useEffect(() => {
    loadWatchlistState().then((state) => setItems(state.items)).catch(() => setItems(getWatchlist()));
  }, []);

  useEffect(() => {
    loadHistoryState().then((state) => setHistory(state.histories)).catch(() => setHistory(getHistory()));
    const refresh = () => setHistory(getHistory());
    window.addEventListener('lrr:history-changed', refresh);
    return () => window.removeEventListener('lrr:history-changed', refresh);
  }, []);

  useEffect(() => {
    const refresh = () => {
      const next = getWatchlist();
      setItems(next);
      setSelectedIds((prev) => {
        const visible = new Set(next.map((item) => item.id));
        return new Set(Array.from(prev).filter((id) => visible.has(id)));
      });
    };
    window.addEventListener('lrr:watchlist-changed', refresh);
    return () => window.removeEventListener('lrr:watchlist-changed', refresh);
  }, []);

  useEffect(() => {
    const check = () => setIsNarrow(window.innerWidth < 600);
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const itemsWithProgress = useMemo(() => mergeWatchlistProgress(items, history), [history, items]);
  const autoRemoveIds = useMemo(() => getWatchlistAutoRemoveIds(itemsWithProgress), [itemsWithProgress]);
  const filteredItems = useMemo(() => itemsWithProgress.filter((item) => archiveMatchesSearch(item, query)), [itemsWithProgress, query]);
  const selectedCount = selectedIds.size;

  useLayoutEffect(() => observeLastArchiveRowCentering(gridRef.current), [cropCover, filteredItems.length, isNarrow]);

  useEffect(() => {
    if (autoRemoveIds.length > 0) removeWatchlistItems(autoRemoveIds).catch(() => {});
  }, [autoRemoveIds]);

  const handleSync = useCallback(async () => {
    if (!getWorkerUrl() || !getSyncToken() || syncing) return;
    setSyncing(true);
    try {
      const state = await loadWatchlistState({ force: true });
      setItems(state.items);
    } finally {
      setSyncing(false);
    }
  }, [syncing]);

  const toggleSelectionMode = useCallback(() => {
    setSelectionMode((value) => {
      const next = !value;
      if (!next) {
        setSelectedIds(new Set());
        setLastSelectedId(null);
      }
      return next;
    });
  }, []);

  const toggleSelection = useCallback((id, event) => {
    if (!id) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (event?.shiftKey && lastSelectedId) {
        const ids = filteredItems.map((item) => item.id);
        const from = ids.indexOf(lastSelectedId);
        const to = ids.indexOf(id);
        if (from >= 0 && to >= 0) {
          const [start, end] = from < to ? [from, to] : [to, from];
          ids.slice(start, end + 1).forEach((rangeId) => next.add(rangeId));
        } else {
          next.add(id);
        }
      } else if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    setLastSelectedId(id);
  }, [filteredItems, lastSelectedId]);

  const selectAllVisible = useCallback(() => {
    setSelectedIds(new Set(filteredItems.map((item) => item.id)));
    setLastSelectedId(filteredItems[0]?.id || null);
  }, [filteredItems]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setLastSelectedId(null);
  }, []);

  const requestBatchDelete = useCallback(() => {
    if (selectedIds.size === 0) return;
    setDeleteTarget({ ids: Array.from(selectedIds), batch: true });
  }, [selectedIds]);

  const requestSingleDelete = useCallback((item) => {
    if (!item?.id) return;
    setDeleteTarget({ ids: [item.id], title: item.title, batch: false });
  }, []);

  const handleRemove = useCallback(async () => {
    if (!Array.isArray(deleteTarget?.ids) || deleteTarget.ids.length === 0) return;
    await removeWatchlistItems(deleteTarget.ids);
    setItems(getWatchlist());
    setSelectedIds((prev) => {
      const removeSet = new Set(deleteTarget.ids);
      return new Set(Array.from(prev).filter((id) => !removeSet.has(id)));
    });
    setDeleteTarget(null);
  }, [deleteTarget]);

  const handleDownload = useCallback(async (archive) => {
    const archiveId = archive?.arcid || archive?.id;
    if (!archiveId) return;
    try {
      const { blob, filename } = await lrrApi.downloadArchive(archiveId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename || `${archiveId}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      alert(err.message || '下载失败');
    }
  }, []);

  const handleCopyLink = useCallback(async (archive) => {
    const archiveId = archive?.arcid || archive?.id;
    if (!archiveId) return;
    const url = `${window.location.origin}/?id=${encodeURIComponent(archiveId)}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      prompt('复制归档链接:', url);
    }
  }, []);

  return (
    <>
      <div style={{ padding: isNarrow ? '16px 10px' : '24px 20px', maxWidth: '1680px', margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '16px', marginBottom: '24px', flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontWeight: 600, margin: '0 0 8px 0', fontSize: '28px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <HeaderGlyph />
              待看归档
            </h1>
            <div style={{ color: 'var(--text-sub)', fontSize: '14px' }}>
              共 {items.length} 个归档{query.trim() ? `，当前显示 ${filteredItems.length} 个` : ''}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button className="btn" onClick={onBack} style={{ fontSize: '13px' }}>返回</button>
            <button
              className="btn"
              onClick={handleSync}
              disabled={!getWorkerUrl() || !getSyncToken() || syncing}
              style={{ fontSize: '13px', opacity: !getWorkerUrl() || !getSyncToken() ? 0.5 : 1 }}
              title={!getWorkerUrl() || !getSyncToken() ? '配置 Worker 后可从远端读取待看归档' : '从 Worker 刷新待看归档'}
            >
              {syncing ? '刷新中' : '刷新'}
            </button>
          </div>
        </div>

        <section className="glass-panel section-reveal section-reveal-delay-1" style={{ padding: isNarrow ? '16px 14px' : '20px 24px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '18px', fontWeight: 600 }}>
                <HeaderGlyph />
                <span>全部待看</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-sub)', fontSize: '13px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {selectedCount > 0 && (
                  <>
                    <span>{selectedCount} 项已选</span>
                    <button className="btn" onClick={requestBatchDelete} style={{ padding: '6px 12px', fontSize: '12px' }}>移除选中</button>
                    <button className="btn" onClick={clearSelection} style={{ padding: '6px 12px', fontSize: '12px' }}>取消选择</button>
                  </>
                )}
                {selectionMode && selectedCount === 0 && filteredItems.length > 0 && (
                  <button className="btn" onClick={selectAllVisible} style={{ padding: '6px 12px', fontSize: '12px' }}>全选当前</button>
                )}
                {filteredItems.length > 0 && (
                  <button
                    className="btn"
                    onClick={toggleSelectionMode}
                    style={{
                      padding: '6px 12px',
                      fontSize: '12px',
                      background: selectionMode ? 'var(--accent)' : undefined,
                      borderColor: selectionMode ? 'var(--accent)' : undefined,
                      color: selectionMode ? '#fff' : undefined,
                    }}
                  >
                    {selectionMode ? '退出多选' : '多选'}
                  </button>
                )}
              </div>
            </div>
            <ArchiveSearchBox query={query} setQuery={setQuery} placeholder="在待看归档中搜索标题或标签" />
          </div>

          {filteredItems.length > 0 ? (
            <div ref={gridRef} className="archive-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: isNarrow ? '10px' : '16px', '--archive-grid-half-gap': isNarrow ? '5px' : '8px' }}>
              {filteredItems.map((item) => {
                const selected = selectedIds.has(item.id);
                return (
                  <ArchiveCard
                    key={`watchlist-${item.id}`}
                    archive={item}
                    className="watchlist-card watchlist-card-plain"
                    wrapStyle={{ position: 'relative' }}
                    overlay={selectionMode ? (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleSelection(item.id, event);
                        }}
                        title="选择待看归档"
                        style={{
                          position: 'absolute',
                          zIndex: 5,
                          top: '8px',
                          left: '8px',
                          width: '28px',
                          height: '28px',
                          borderRadius: '8px',
                          border: selected ? '1px solid var(--accent)' : '1px solid rgba(255,255,255,0.26)',
                          background: selected ? 'var(--accent)' : 'rgba(8,10,14,0.78)',
                          color: '#fff',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
                        }}
                      >
                        {selected ? '✓' : ''}
                      </button>
                    ) : null}
                    onClick={(event) => {
                      if (selectionMode) toggleSelection(item.id, event);
                      else onSelectArchive(item.id);
                    }}
                    onArchiveContextMenu={(archive, point) => setMenu({ archive, x: point.x, y: point.y, showRemoveWatchlist: true })}
                    onLongPress={() => requestSingleDelete(item)}
                    longPressTitle="移除待看"
                    currentPage={item.page}
                    showProgressBar={showHistoricalArchiveProgress}
                    reserveProgressSpace={reserveGlobalProgressSpace}
                    noCrop={!cropCover}
                    selectionMode={selectionMode}
                    selected={selected}
                    onSelectToggle={(archive, event) => toggleSelection(archive.id || archive.arcid, event)}
                  />
                );
              })}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--text-sub)', fontSize: '14px' }}>
              {items.length > 0 ? '没有匹配的待看归档' : '暂无待看归档'}
            </div>
          )}
        </section>
      </div>

      <ArchiveContextMenu
        menu={menu}
        onClose={() => setMenu(null)}
        onRead={(archive) => onSelectArchive(archive.arcid || archive.id)}
        onEditMetadata={(archive) => navigateToMetadata(archive.arcid || archive.id)}
        onDownload={handleDownload}
        onCopyLink={handleCopyLink}
        onRemoveWatchlist={(archive) => requestSingleDelete(archive)}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        title="确认移除待看"
        message={deleteTarget ? (deleteTarget.batch ? `将选中的 ${deleteTarget.ids.length} 个归档从待看中移除。` : `将“${deleteTarget.title}”从待看中移除。`) : ''}
        confirmLabel="确认移除"
        cancelLabel="取消"
        onConfirm={handleRemove}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
