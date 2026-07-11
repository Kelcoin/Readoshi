import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  destructive = true,
  confirmDisabled = false,
  children,
}) {
  useEffect(() => {
    if (!open) return undefined;

    const prevOverflow = document.body.style.overflow;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onCancel?.();
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onCancel, open]);

  if (!open) return null;

  return createPortal(
    <div
      data-dialog-overlay
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200000,
        background: 'rgba(0,0,0,0.58)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
      }}
    >
      <div
        className="glass-panel dropdown-animate"
        data-dialog-root
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '420px',
          padding: '26px 24px 22px',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTouchCallout: 'none',
        }}
      >
        <div style={{ fontSize: '20px', fontWeight: 700, color: '#e3e9f3' }}>
          {title}
        </div>
        {message && (
          <div style={{ fontSize: '13px', lineHeight: 1.7, color: 'var(--text-sub)', userSelect: 'none', WebkitUserSelect: 'none' }}>
            {message}
          </div>
        )}
        {children}
        <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
          <button
            type="button"
            className="btn"
            onClick={onCancel}
            style={{ flex: 1, padding: '10px 14px' }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="btn"
            onClick={onConfirm}
            disabled={confirmDisabled}
            style={{
              flex: 1,
              padding: '10px 14px',
              background: destructive ? 'rgba(244,67,54,0.18)' : undefined,
              borderColor: destructive ? 'rgba(244,67,54,0.32)' : undefined,
              color: destructive ? '#ffd2d0' : undefined,
              opacity: confirmDisabled ? 0.55 : undefined,
              cursor: confirmDisabled ? 'not-allowed' : undefined,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
