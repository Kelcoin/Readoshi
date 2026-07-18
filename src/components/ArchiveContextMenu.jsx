import React, { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { hasArchiveReadingProgress } from '../lib/archiveProgress';

function clampMenuPosition(x, y, height = 178) {
  const width = 150;
  const gap = 8;
  return {
    left: Math.min(Math.max(gap, x), Math.max(gap, window.innerWidth - width - gap)),
    top: Math.min(Math.max(gap, y), Math.max(gap, window.innerHeight - height - gap)),
  };
}

function MenuButton({ children, danger = false, onClick }) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`archive-context-menu-item${danger ? ' is-danger' : ''}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export default function ArchiveContextMenu({ menu, onClose, onRead, onClearProgress, onEditMetadata, onDownload, onDelete, onCopyLink, onRemoveHistory, onAddWatchlist, onRemoveWatchlist }) {
  const showRemoveHistory = !!menu?.showRemoveHistory && !!onRemoveHistory;
  const showRemoveWatchlist = !!menu?.showRemoveWatchlist && !!onRemoveWatchlist;
  const showAddWatchlist = !showRemoveWatchlist && !!onAddWatchlist;
  const showClearProgress = !!onClearProgress && hasArchiveReadingProgress(menu?.archive);
  const extraRows = (showRemoveHistory ? 1 : 0) + (showRemoveWatchlist || showAddWatchlist ? 1 : 0) + (onDelete ? 1 : 0) + (onEditMetadata ? 1 : 0) + (showClearProgress ? 1 : 0);
  const menuHeight = 142 + extraRows * 36;
  const pos = useMemo(() => clampMenuPosition(menu?.x || 0, menu?.y || 0, menuHeight), [menu?.x, menu?.y, menuHeight]);

  useEffect(() => {
    if (!menu) return undefined;
    const close = () => onClose?.();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [menu, onClose]);

  if (!menu?.archive) return null;

  const run = (action) => (event) => {
    event.stopPropagation();
    action?.(menu.archive);
    onClose?.();
  };
  const runClearProgress = async (event) => {
    event.stopPropagation();
    try {
      const result = await onClearProgress(menu.archive);
      if (result?.fallback) window.alert('服务器不支持清零，已回退到第一页。');
    } catch (error) {
      window.alert(`清除阅读进度失败：${error?.message || '未知错误'}`);
    } finally {
      onClose?.();
    }
  };

  return createPortal(
    <div
      role="menu"
      className="archive-context-menu dropdown-animate"
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        left: `${pos.left}px`,
        top: `${pos.top}px`,
      }}
    >
      <MenuButton onClick={run(onRead)}>阅读</MenuButton>
      {showClearProgress && <MenuButton onClick={runClearProgress}>清除阅读进度</MenuButton>}
      {onEditMetadata && <MenuButton onClick={run(onEditMetadata)}>编辑元数据</MenuButton>}
      <MenuButton onClick={run(onDownload)}>下载</MenuButton>
      <MenuButton onClick={run(onCopyLink)}>复制链接</MenuButton>
      {showAddWatchlist && <MenuButton onClick={run(onAddWatchlist)}>加入待看</MenuButton>}
      {showRemoveWatchlist && <MenuButton danger onClick={run(onRemoveWatchlist)}>取消待看</MenuButton>}
      {showRemoveHistory && <MenuButton danger onClick={run(onRemoveHistory)}>删除历史记录</MenuButton>}
      {onDelete && <div className="archive-context-menu-divider" />}
      {onDelete && <MenuButton danger onClick={run(onDelete)}>删除</MenuButton>}
    </div>,
    document.body,
  );
}

