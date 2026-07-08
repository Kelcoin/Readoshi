import React, { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';

function clampMenuPosition(x, y, height = 178) {
  const width = 178;
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
      onClick={onClick}
      style={{
        width: '100%',
        padding: '9px 12px',
        border: 'none',
        borderRadius: '6px',
        background: 'transparent',
        color: danger ? '#ff8f8f' : '#e8edf5',
        fontSize: '13px',
        textAlign: 'left',
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = danger ? 'rgba(244,67,54,0.14)' : 'rgba(255,255,255,0.08)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      {children}
    </button>
  );
}

export default function ArchiveContextMenu({ menu, onClose, onRead, onDownload, onDelete, onCopyLink, onRemoveHistory }) {
  const showRemoveHistory = !!menu?.showRemoveHistory && !!onRemoveHistory;
  const menuHeight = showRemoveHistory ? 214 : 178;
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

  return createPortal(
    <div
      role="menu"
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'fixed',
        left: `${pos.left}px`,
        top: `${pos.top}px`,
        zIndex: 100000,
        width: '178px',
        padding: '6px',
        borderRadius: '8px',
        border: '1px solid rgba(255,255,255,0.12)',
        background: 'rgba(18,20,27,0.98)',
        boxShadow: '0 14px 42px rgba(0,0,0,0.48)',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
      }}
    >
      <MenuButton onClick={run(onRead)}>阅读</MenuButton>
      <MenuButton onClick={run(onDownload)}>下载</MenuButton>
      <MenuButton onClick={run(onCopyLink)}>复制链接</MenuButton>
      {showRemoveHistory && <MenuButton danger onClick={run(onRemoveHistory)}>删除历史记录</MenuButton>}
      <div style={{ height: '1px', background: 'rgba(255,255,255,0.08)', margin: '4px 2px' }} />
      <MenuButton danger onClick={run(onDelete)}>删除</MenuButton>
    </div>,
    document.body,
  );
}

