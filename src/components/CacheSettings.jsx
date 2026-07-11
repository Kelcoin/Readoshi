import React, { useCallback, useEffect, useState } from 'react';
import { clearImageCache, enforceImageCacheLimit, getImageCacheStats, setImageCacheLimit } from '../lib/imageCache';

const formatBytes = (bytes) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;

export default function CacheSettings() {
  const [stats, setStats] = useState(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => getImageCacheStats().then(setStats).catch(() => setStats(null)), []);
  useEffect(() => { refresh(); }, [refresh]);
  const run = async (operation) => { setBusy(true); try { await operation(); await refresh(); } finally { setBusy(false); } };
  return <div style={{ borderTop: '1px solid var(--glass-border)', paddingTop: 14 }}>
    <div style={{ fontSize: 12, color: 'var(--text-sub)', marginBottom: 12 }}>图片缓存</div>
    <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, fontSize: 13 }}>
      最大容量
      <select className="input-glass" value={stats?.mode || 'auto'} disabled={busy} onChange={event => run(() => setImageCacheLimit(event.target.value))} style={{ width: 180 }}>
        <option value="auto">自动（配额 20%）</option><option value="mb256">256 MB</option><option value="mb512">512 MB</option><option value="gb1">1 GB</option><option value="gb2">2 GB</option>
      </select>
    </label>
    <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-sub)' }}>{stats ? `已用 ${formatBytes(stats.bytes)} / ${formatBytes(stats.limit)} · ${stats.entries} 项` : '暂时无法读取缓存用量'}</div>
    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}><button type="button" className="btn" disabled={busy} onClick={() => run(() => enforceImageCacheLimit())}>智能清理</button><button type="button" className="btn" disabled={busy} onClick={() => run(async () => clearImageCache({ disk: true }))}>清空缓存</button></div>
  </div>;
}
