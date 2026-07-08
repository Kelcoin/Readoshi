import React, { useState, useEffect } from 'react';
import Reader from './pages/Reader';
import Home from './pages/Home';
import HistoryPage from './pages/HistoryPage';
import { loadTagDB } from './lib/tags';
import { checkServerStatus } from './lib/api';
import { navigateHome, navigateToArchive, parseRouteFromLocation } from './lib/navigation';
import { startHistoryExistenceCheckTimer, stopHistoryExistenceCheckTimer } from './lib/historyMaintenance';
import { getWorkerUrl, setWorkerUrl, getSyncToken, setSyncToken, exportConfig, importConfig } from './lib/worker-config';
import PwaStatus from './components/PwaStatus';
import './index.css';

export default function App() {
  const [route, setRoute] = useState(() => parseRouteFromLocation());
  
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
  const [workerConfigOpen, setWorkerConfigOpen] = useState(false);
  
  useEffect(() => {
    loadTagDB(); 
  }, []);

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
      await checkServerStatus(tempConfig.url, tempConfig.key);
      localStorage.setItem('lrr_server_url', tempConfig.url);
      localStorage.setItem('lrr_api_key', tempConfig.key);
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
        <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', padding: '20px', overflowY: 'auto', boxSizing: 'border-box' }}>
          <form onSubmit={handleConnect} className="glass-panel" style={{ padding: '36px 30px', display: 'flex', flexDirection: 'column', gap: '20px', width: '100%', maxWidth: '440px', margin: 'auto 0' }}>
            <div style={{ textAlign: 'center', marginBottom: '8px' }}>
              <h2 style={{ margin: '0 0 8px 0', fontSize: '24px' }}>配置 LANraragi</h2>
              <div style={{ fontSize: '13px', color: 'var(--text-sub)' }}>连接到你的专属私人漫画库</div>
            </div>
            
            <div>
              <label style={{ display: 'block', fontSize: '13px', marginBottom: '8px', color: 'var(--text-sub)' }}>服务器地址 *</label>
              <input type="text" className="input-glass" placeholder="如 http://192.168.1.10:3000" value={tempConfig.url} onChange={e => setTempConfig({...tempConfig, url: e.target.value})} required />
            </div>
            
            <div>
              <label style={{ display: 'block', fontSize: '13px', marginBottom: '8px', color: 'var(--text-sub)' }}>API Key *</label>
              <input type="password" className="input-glass" placeholder="在 LRR 设置页面获取" value={tempConfig.key} onChange={e => setTempConfig({...tempConfig, key: e.target.value})} required />
            </div>

            <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '14px' }}>
              <button
                type="button"
                onClick={() => setWorkerConfigOpen(v => !v)}
                title={workerConfigOpen ? '收起Worker设置' : '展开Worker设置'}
                style={{
                  width: '100%',
                  padding: '0 4px',
                  fontSize: '13px',
                  color: 'var(--text-sub)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                <span>Worker 相关设置</span>
                <span style={{ color: '#ccc', opacity: 0.8, padding: '4px', display: 'flex' }}>
                  <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" style={{ transition: 'transform 0.3s', transform: workerConfigOpen ? 'rotate(0deg)' : 'rotate(180deg)' }}>
                    <path d="M6 15l6-6 6 6z" />
                  </svg>
                </span>
              </button>
              <div style={{
                overflow: 'hidden',
                maxHeight: workerConfigOpen ? '230px' : '0px',
                opacity: workerConfigOpen ? 1 : 0,
                transition: 'max-height 0.28s cubic-bezier(0.4,0,0.2,1), opacity 0.2s ease',
              }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '14px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', marginBottom: '8px', color: 'var(--text-sub)' }}>Cloudflare Worker 端点</label>
                    <input type="text" className="input-glass" placeholder="https://lrr-sync.xxx.workers.dev" value={tempConfig.workerUrl} onChange={e => setTempConfig({...tempConfig, workerUrl: e.target.value})} />
                    <div style={{ fontSize: '11px', color: 'var(--text-sub)', marginTop: '5px', lineHeight: 1.5 }}>
                      用于 EH 评论代理与远端阅读历史
                    </div>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '13px', marginBottom: '8px', color: 'var(--text-sub)' }}>访问 Token</label>
                    <input type="password" className="input-glass" placeholder="需与 KV 空间 tokens 字段中的 Token 保持一致" value={tempConfig.syncToken} onChange={e => setTempConfig({...tempConfig, syncToken: e.target.value})} />
                  </div>
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

            <button type="submit" className="btn" style={{ marginTop: '8px', padding: '12px' }} disabled={loginLoading}>
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

  if (route.kind === 'history') {
    return (
      <>
        <HistoryPage onSelectArchive={(id) => navigateToArchive(id)} onBack={() => navigateHome()} />
        <PwaStatus />
      </>
    );
  }

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
      }} />
      <PwaStatus />
    </>
  );
}
