import React, { useEffect, useState } from 'react';

export default function PwaStatus() {
  const [updateWorker, setUpdateWorker] = useState(null);
  const [connectionMessage, setConnectionMessage] = useState(() => (
    navigator.onLine ? '' : '已离线，可继续打开已缓存页面'
  ));

  useEffect(() => {
    const handleBeforeInstallPrompt = (event) => {
      event.preventDefault();
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  useEffect(() => {
    const handleUpdateReady = (event) => {
      const worker = event.detail?.worker;
      if (!worker) return;
      setUpdateWorker(worker);
    };

    window.addEventListener('lrr:pwa-update-ready', handleUpdateReady);
    return () => window.removeEventListener('lrr:pwa-update-ready', handleUpdateReady);
  }, []);

  useEffect(() => {
    if (!updateWorker) return undefined;
    const applyTimer = setTimeout(() => {
      updateWorker.postMessage({ type: 'SKIP_WAITING' });
    }, 900);
    return () => clearTimeout(applyTimer);
  }, [updateWorker]);

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

  const primary = updateWorker
    ? { message: '新版本已就绪，即将刷新以应用。' }
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
          padding: '8px 14px',
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
        <span style={{ flex: 1, minWidth: 0, fontSize: '13px', fontWeight: 600, textAlign: 'center' }}>
          {primary.message}
        </span>
      </div>
    </div>
  );
}
