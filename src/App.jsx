import React, { useState, useEffect } from 'react';
import Reader from './pages/Reader';
import Home from './pages/Home';
import HistoryPage from './pages/HistoryPage';
import WatchlistPage from './pages/WatchlistPage';
import DeduplicatePage from './pages/DeduplicatePage';
import MetadataPage from './pages/MetadataPage';
import UploadPage from './pages/UploadPage';
import { loadTagDB } from './lib/tags';
import { checkServerStatus } from './lib/api';
import { navigateHome, navigateToArchive, parseRouteFromLocation } from './lib/navigation';
import { startHistoryExistenceCheckTimer, stopHistoryExistenceCheckTimer } from './lib/historyMaintenance';
import { getWorkerUrl, setWorkerUrl, getSyncToken, setSyncToken, exportConfig, importConfig } from './lib/worker-config';
import { applyThemeMode, getNextThemeMode, readStoredThemeMode, watchSystemTheme, writeStoredThemeMode } from './lib/theme';
import PwaStatus from './components/PwaStatus';
import AppVersion from './components/AppVersion';
import { cacheServerInfo } from './lib/serverInfoCache';
import './index.css';

export default function App() {
  const [route, setRoute] = useState(() => parseRouteFromLocation());
  const [themeMode, setThemeMode] = useState(() => {
    const mode = readStoredThemeMode();
    applyThemeMode(mode);
    return mode;
  });
  
  const [savedConfig, setSavedConfig] = useState({
    url: localStorage.getItem('lrr_server_url') || '',
    key: localStorage.getItem('lrr_api_key') || ''
  });

  const [tempConfig, setTempConfig] = useState({
    url: savedConfig.url,
    key: savedConfig.key,
    workerUrl: getWorkerUrl(),
    syncToken: getSyncToken(),
  });

  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  
  useEffect(() => {
    const run = () => loadTagDB();
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(run, { timeout: 1500 });
      return () => cancelIdleCallback(id);
    }
    const timer = setTimeout(run, 250);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    applyThemeMode(themeMode);
    writeStoredThemeMode(themeMode);
    return watchSystemTheme(() => {
      if (themeMode === 'auto') applyThemeMode(themeMode);
    });
  }, [themeMode]);

  const handleThemeModeChange = () => {
    setThemeMode((mode) => getNextThemeMode(mode));
  };

  useEffect(() => {
    const applyRoute = (route) => {
      setRoute(route);
    };

    const handleNavigate = (event) => {
      applyRoute(event.detail || parseRouteFromLocation());
    };
    const handlePopState = () => {
      applyRoute(parseRouteFromLocation());
    };

    window.addEventListener('lrr:navigate', handleNavigate);
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('lrr:navigate', handleNavigate);
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  useEffect(() => {
    if (!savedConfig.url || !savedConfig.key) return undefined;
    startHistoryExistenceCheckTimer();
    return () => stopHistoryExistenceCheckTimer();
  }, [savedConfig.url, savedConfig.key]);

  const handleConnect = async (e) => {
    e.preventDefault();
    setLoginError('');
    setLoginLoading(true);
    try {
      const serverInfo = await checkServerStatus(tempConfig.url, tempConfig.key);
      localStorage.setItem('lrr_server_url', tempConfig.url);
      localStorage.setItem('lrr_api_key', tempConfig.key);
      cacheServerInfo(serverInfo);
      setWorkerUrl(tempConfig.workerUrl);
      setSyncToken(tempConfig.syncToken);
      setSavedConfig({ url: tempConfig.url, key: tempConfig.key });
    } catch (err) {
      setLoginError(err.message || '无法连接到服务器，请检查地址和 API Key 是否正确，以及 LRR 服务是否在运行');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleExportConfig = () => {
    let cfg = {};
    try { cfg = JSON.parse(atob(exportConfig())); } catch {}
    if (tempConfig.url) cfg.lrr_server_url = tempConfig.url;
    if (tempConfig.key) cfg.lrr_api_key = tempConfig.key;
    if (tempConfig.workerUrl) cfg.lrr_worker_url = tempConfig.workerUrl;
    if (tempConfig.syncToken) cfg.lrr_sync_token = tempConfig.syncToken;
    const encoded = btoa(JSON.stringify(cfg));
    navigator.clipboard.writeText(encoded).then(() => {
      alert('配置已复制到剪贴板。在其他设备粘贴导入即可。');
    }).catch(() => {
      prompt('复制以下文本到其他设备导入:', encoded);
    });
  };

  const handleImportConfig = async () => {
    let encoded = '';
    try { encoded = await navigator.clipboard.readText(); } catch {}
    if (!encoded) encoded = prompt('粘贴从其他设备导出的配置文本:') || '';
    if (!encoded) return;
    try {
      const count = importConfig(encoded);
      const next = {
        url: localStorage.getItem('lrr_server_url') || '',
        key: localStorage.getItem('lrr_api_key') || '',
        workerUrl: getWorkerUrl(),
        syncToken: getSyncToken(),
      };
      setTempConfig(next);
      alert(`已导入 ${count} 项配置`);
    } catch (err) {
      setLoginError(err.message || '导入失败');
    }
  };

  if (!savedConfig.url || !savedConfig.key) {
    return (
      <>
        <div className="login-shell">
          <div className="login-stack">
          <form onSubmit={handleConnect} className="glass-panel login-card">
            <div style={{ textAlign: 'center', marginBottom: '8px' }}>
              <h2 className="login-title">配置 LANraragi</h2>
              <div style={{ fontSize: '13px', color: 'var(--text-sub)' }}>连接到你的专属私人漫画库</div>
            </div>
            
            <div>
              <label className="field-label">服务器地址 *</label>
              <input type="text" className="input-glass" placeholder="如 http://192.168.1.10:3000" value={tempConfig.url} onChange={e => setTempConfig({...tempConfig, url: e.target.value})} required />
            </div>
            
            <div>
              <label className="field-label">API Key *</label>
              <input type="password" className="input-glass" placeholder="在 LRR 设置页面获取" value={tempConfig.key} onChange={e => setTempConfig({...tempConfig, key: e.target.value})} required />
            </div>

            <div style={{ borderTop: '1px solid var(--glass-border)', paddingTop: '14px' }}>
              <div style={{ fontSize: '13px', color: 'var(--text-sub)', marginBottom: '12px', padding: '0 4px' }}>Worker 设置</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div>
                  <label className="field-label">Cloudflare Worker 端点</label>
                  <input type="text" className="input-glass" placeholder="https://lrr-sync.xxx.workers.dev" value={tempConfig.workerUrl} onChange={e => setTempConfig({...tempConfig, workerUrl: e.target.value})} />
                </div>

                <div>
                  <label className="field-label">访问 Token</label>
                  <span className="secret-input-shell" data-secret={tempConfig.syncToken}>
                    <input type="text" className="input-glass secret-input" placeholder="需与 KV 空间 tokens 字段中的 Token 保持一致" value={tempConfig.syncToken} onChange={e => setTempConfig({...tempConfig, syncToken: e.target.value})} />
                  </span>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button type="button" className="btn" onClick={handleExportConfig} style={{ flex: 1, padding: '9px', fontSize: '12px' }}>
                导出配置
              </button>
              <button type="button" className="btn" onClick={handleImportConfig} style={{ flex: 1, padding: '9px', fontSize: '12px' }}>
                导入配置
              </button>
            </div>

            <button type="submit" className="btn" style={{ marginTop: '8px', padding: '12px', background: 'linear-gradient(180deg, rgba(88,183,255,0.36), rgba(88,183,255,0.18))', borderColor: 'rgba(141,216,255,0.58)' }} disabled={loginLoading}>
              {loginLoading ? '正在验证连接...' : '开始阅读'}
            </button>

            {loginError && (
              <div style={{
                background: 'rgba(244,67,54,0.12)', border: '1px solid rgba(244,67,54,0.3)',
                borderRadius: '8px', padding: '10px 14px', fontSize: '13px', color: '#f44336',
                lineHeight: 1.5
              }}>
                {loginError}
              </div>
            )}
          </form>
          <AppVersion />
          </div>
        </div>
        <PwaStatus />
      </>
    );
  }

  if (route.kind === 'reader') {
    return (
      <>
        <Reader key={route.archiveId} archiveId={route.archiveId} onBack={() => navigateHome()} />
        <PwaStatus />
      </>
    );
  }

  if (route.kind === 'metadata') return <><MetadataPage archiveId={route.archiveId} /><PwaStatus /></>;

  if (route.kind === 'history') {
    return (
      <>
        <HistoryPage onSelectArchive={(id) => navigateToArchive(id)} onBack={() => navigateHome()} />
        <PwaStatus />
      </>
    );
  }

  if (route.kind === 'watchlist') {
    return (
      <>
        <WatchlistPage onSelectArchive={(id) => navigateToArchive(id)} onBack={() => navigateHome()} />
        <PwaStatus />
      </>
    );
  }

  if (route.kind === 'dedupe') {
    return (
      <>
        <DeduplicatePage onBack={() => navigateHome()} />
        <PwaStatus />
      </>
    );
  }

  if (route.kind === 'upload') return <><UploadPage /><PwaStatus /></>;

  return (
    <>
      <Home onSelectArchive={(id) => {
        navigateToArchive(id);
      }} onLogout={() => {
        setSavedConfig({ url: '', key: '' });
        setTempConfig({
          url: localStorage.getItem('lrr_server_url') || '',
          key: localStorage.getItem('lrr_api_key') || '',
          workerUrl: getWorkerUrl(),
          syncToken: getSyncToken(),
        });
        navigateHome({ replace: true });
      }} themeMode={themeMode} onThemeModeChange={handleThemeModeChange} />
      <PwaStatus />
    </>
  );
}
