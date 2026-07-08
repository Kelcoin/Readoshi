import { lrrApi } from './api';
import { getConfigFingerprint } from './sessionState';

const KEY = 'lrr_server_info_cache_v1';
const TTL = 30 * 60 * 1000;

function readCache() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.configId !== getConfigFingerprint()) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      configId: getConfigFingerprint(),
      ts: Date.now(),
      data,
    }));
  } catch {}
}

export function getStoredServerInfo({ allowStale = true } = {}) {
  const cached = readCache();
  if (!cached) return null;
  if (!allowStale && Date.now() - cached.ts > TTL) return null;
  return cached.data || null;
}

export async function loadServerInfo({ cacheOnly = false, forceRefresh = false } = {}) {
  const cached = forceRefresh ? null : getStoredServerInfo({ allowStale: !cacheOnly });
  if (cached) return cached;
  if (cacheOnly) return null;
  const info = await lrrApi.getServerInfo();
  writeCache(info);
  return info;
}
