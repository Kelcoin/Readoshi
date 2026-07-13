import React, { useEffect, useId, useRef } from 'react';
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
  const titleId = useId();
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    const prevOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onCancel?.();
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    const focusFrame = requestAnimationFrame(() => dialogRef.current?.querySelector('[data-dialog-cancel]')?.focus());

    return () => {
      cancelAnimationFrame(focusFrame);
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocused instanceof HTMLElement && document.contains(previouslyFocused)) previouslyFocused.focus();
    };
  }, [onCancel, open]);

  if (!open) return null;

  return createPortal(
    <div
      className="confirm-dialog-overlay"
      data-dialog-overlay
      onClick={onCancel}
    >
      <div
        ref={dialogRef}
        className="glass-panel dropdown-animate confirm-dialog"
        data-dialog-root
        role={destructive ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="confirm-dialog-title" id={titleId}>
          {title}
        </div>
        {message && (
          <div className="confirm-dialog-message">
            {message}
          </div>
        )}
        {children}
        <div className="confirm-dialog-actions">
          <button
            type="button"
            className="btn"
            data-dialog-cancel
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn confirm-dialog-confirm${destructive ? ' is-destructive' : ''}`}
            onClick={onConfirm}
            disabled={confirmDisabled}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
