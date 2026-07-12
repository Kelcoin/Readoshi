import React, { useCallback, useEffect, useState } from 'react';
import { clearImageCache, enforceImageCacheLimit, getImageCacheStats, setImageCacheLimit } from '../lib/imageCache';
import CustomSelect from './CustomSelect';

const formatBytes = (bytes) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;

export default function CacheSettings() {
  const [stats, setStats] = useState(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => getImageCacheStats().then(setStats).catch(() => setStats(null)), []);
  useEffect(() => { refresh(); }, [refresh]);
  const run = async (operation) => { setBusy(true); try { await operation(); await refresh(); } finally { setBusy(false); } };
  const options = [
    { label: '自动', value: 'auto' },
    { label: '256 MB', value: 'mb256' },
    { label: '512 MB', value: 'mb512' },
    { label: '1 GB', value: 'gb1' },
    { label: '2 GB', value: 'gb2' },
  ];
  return <div className="settings-section">
    <div className="settings-section-title">图片缓存</div>
    <label className="settings-row" title="自动模式会使用浏览器可用空间的一小部分，并在缓存过大时优先清理较旧图片。">
      <span className="settings-row-title">最大容量</span>
      <div style={{ width: 128, pointerEvents: busy ? 'none' : 'auto', opacity: busy ? 0.6 : 1 }}>
        <CustomSelect value={stats?.mode || 'auto'} options={options} onChange={(value) => run(() => setImageCacheLimit(value))} compact />
      </div>
    </label>
    <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-sub)' }}>{stats ? `已用 ${formatBytes(stats.bytes)} / ${formatBytes(stats.limit)} · ${stats.entries} 项` : '暂时无法读取缓存用量'}</div>
    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}><button type="button" className="btn" disabled={busy} onClick={() => run(() => enforceImageCacheLimit())}>智能清理</button><button type="button" className="btn" disabled={busy} onClick={() => run(async () => clearImageCache({ disk: true }))}>清空缓存</button></div>
  </div>;
}
