import React, { useEffect, useState } from 'react';

const INSTALL_DISMISS_KEY = 'lrr_pwa_install_dismissed_at';
const INSTALL_DISMISS_MS = 7 * 24 * 60 * 60 * 1000;

function isStandaloneDisplay() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

function wasInstallDismissedRecently() {
  try {
    const dismissedAt = Number(localStorage.getItem(INSTALL_DISMISS_KEY) || 0);
    return dismissedAt > 0 && Date.now() - dismissedAt < INSTALL_DISMISS_MS;
  } catch {
    return false;
  }
}

function dismissInstallPrompt() {
  try {
    localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now()));
  } catch {}
}

export default function PwaStatus() {
  const [installPrompt, setInstallPrompt] = useState(null);
  const [updateWorker, setUpdateWorker] = useState(null);
  const [connectionMessage, setConnectionMessage] = useState(() => (
    navigator.onLine ? '' : '已离线，可继续打开已缓存页面'
  ));

  useEffect(() => {
    const handleBeforeInstallPrompt = (event) => {
      if (isStandaloneDisplay() || wasInstallDismissedRecently()) return;
      event.preventDefault();
      setInstallPrompt(event);
    };

    const handleAppInstalled = () => {
      setInstallPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  useEffect(() => {
    const handleUpdateReady = (event) => {
      if (event.detail?.worker) setUpdateWorker(event.detail.worker);
    };

    window.addEventListener('lrr:pwa-update-ready', handleUpdateReady);
    return () => window.removeEventListener('lrr:pwa-update-ready', handleUpdateReady);
  }, []);

  useEffect(() => {
    let clearTimer = null;

    const clearLater = () => {
      if (clearTimer) clearTimeout(clearTimer);
      clearTimer = setTimeout(() => setConnectionMessage(''), 2600);
    };

    const handleOffline = () => {
      setConnectionMessage('已离线，可继续打开已缓存页面');
      if (clearTimer) clearTimeout(clearTimer);
      clearTimer = null;
    };
    const handleOnline = () => {
      setConnectionMessage('连接已恢复');
      clearLater();
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
      if (clearTimer) clearTimeout(clearTimer);
    };
  }, []);

  const handleInstall = async () => {
    if (!installPrompt) return;
    const prompt = installPrompt;
    setInstallPrompt(null);
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch {}
  };

  const handleDismissInstall = () => {
    dismissInstallPrompt();
    setInstallPrompt(null);
  };

  const handleApplyUpdate = () => {
    if (!updateWorker) return;
    updateWorker.postMessage({ type: 'SKIP_WAITING' });
  };

  const primary = updateWorker
    ? {
        message: '新版本已就绪',
        action: '刷新',
        onAction: handleApplyUpdate,
        onClose: () => setUpdateWorker(null),
      }
    : installPrompt
      ? {
          message: '可安装为应用',
          action: '安装',
          onAction: handleInstall,
          onClose: handleDismissInstall,
        }
      : connectionMessage
        ? { message: connectionMessage }
        : null;

  if (!primary) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        left: 'max(14px, env(safe-area-inset-left, 0px))',
        right: 'max(14px, env(safe-area-inset-right, 0px))',
        bottom: 'max(14px, env(safe-area-inset-bottom, 0px))',
        zIndex: 100000,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          width: 'min(420px, 100%)',
          minHeight: '44px',
          padding: '8px 10px 8px 14px',
          borderRadius: '8px',
          border: '1px solid rgba(255,255,255,0.14)',
          background: 'rgba(16,18,24,0.92)',
          color: '#e3e9f3',
          boxShadow: '0 12px 34px rgba(0,0,0,0.42)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          pointerEvents: 'auto',
        }}
      >
        <span style={{ flex: 1, minWidth: 0, fontSize: '13px', fontWeight: 600 }}>
          {primary.message}
        </span>
        {primary.action && (
          <button
            type="button"
            className="btn"
            onClick={primary.onAction}
            style={{ padding: '6px 12px', fontSize: '12px', flexShrink: 0 }}
          >
            {primary.action}
          </button>
        )}
        {primary.onClose && (
          <button
            type="button"
            onClick={primary.onClose}
            aria-label="关闭"
            title="关闭"
            style={{
              width: '28px',
              height: '28px',
              border: 'none',
              borderRadius: '6px',
              background: 'transparent',
              color: 'rgba(227,233,243,0.72)',
              cursor: 'pointer',
              fontSize: '18px',
              lineHeight: 1,
              flexShrink: 0,
            }}
          >
            x
          </button>
        )}
      </div>
    </div>
  );
}
