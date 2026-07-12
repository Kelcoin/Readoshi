const WORKER_URL_KEY = 'lrr_worker_url';
const SYNC_TOKEN_KEY = 'lrr_sync_token';

export function getWorkerUrl() {
  return localStorage.getItem(WORKER_URL_KEY) || '';
}

export function setWorkerUrl(url) {
  if (url) localStorage.setItem(WORKER_URL_KEY, url);
  else localStorage.removeItem(WORKER_URL_KEY);
}

export function getSyncToken() {
  return localStorage.getItem(SYNC_TOKEN_KEY) || '';
}

export function setSyncToken(token) {
  if (token) localStorage.setItem(SYNC_TOKEN_KEY, token);
  else localStorage.removeItem(SYNC_TOKEN_KEY);
}

// ── Config Export / Import ─────────────────────────────────────
const CONFIG_KEYS = [
  'lrr_server_url',
  'lrr_api_key',
  'lrr_worker_url',
  'lrr_sync_token',
  'lrr_eh_cookie',
  'lrr_eh_min_score',
  'lrr_eh_max_comments',
  'lrr_eh_sort_method',
  'lrr_eh_sort_order',
  'lrr_reader_settings',
  'lrr_hide_read',
  'lrr_filter',
  'lrr_crop_cover',
  'lrr_archive_browse_mode',
  'lrr_eh_favorite_delete_sync',
  'lrr_image_cache_limit',
  'lrr_theme_mode',
  'lrr_filter_presets',
];

export function exportConfig() {
  const cfg = {};
  for (const key of CONFIG_KEYS) {
    const val = localStorage.getItem(key);
    if (val) cfg[key] = val;
  }
  return btoa(JSON.stringify(cfg));
}

export function importConfig(encoded) {
  let cfg;
  try {
    cfg = JSON.parse(atob(encoded));
  } catch {
    throw new Error('无效的配置数据：无法解码');
  }
  if (!cfg || typeof cfg !== 'object') throw new Error('无效的配置数据：格式错误');
  let count = 0;
  for (const key of CONFIG_KEYS) {
    if (cfg[key] !== undefined) {
      localStorage.setItem(key, cfg[key]);
      count++;
    }
  }
  if (count === 0) throw new Error('配置数据中未包含任何有效字段');
  return count;
}
