const EH_FAVORITE_DELETE_SYNC_KEY = 'lrr_eh_favorite_delete_sync';

export function shouldSyncEhFavorite(globalEnabled, confirmationEnabled) {
  return !!globalEnabled && !!confirmationEnabled;
}

export function getEhFavoriteDeleteSync() {
  try {
    return localStorage.getItem(EH_FAVORITE_DELETE_SYNC_KEY) === '1';
  } catch {
    return false;
  }
}

export function setEhFavoriteDeleteSync(enabled) {
  try {
    if (enabled) localStorage.setItem(EH_FAVORITE_DELETE_SYNC_KEY, '1');
    else localStorage.removeItem(EH_FAVORITE_DELETE_SYNC_KEY);
  } catch {}
}

export function getEhCookie() {
  try {
    const standalone = localStorage.getItem('lrr_eh_cookie') || '';
    if (standalone.trim()) return standalone.trim();
    const settings = JSON.parse(localStorage.getItem('lrr_reader_settings') || '{}');
    return typeof settings.ehCookie === 'string' ? settings.ehCookie.trim() : '';
  } catch {
    return '';
  }
}

export function hasValidEhCookie(cookie = getEhCookie()) {
  const value = String(cookie || '').trim();
  if (!value) return false;
  return /(?:^|;\s*)ipb_member_id\s*=\s*[^;\s]+/i.test(value)
    && /(?:^|;\s*)ipb_pass_hash\s*=\s*[^;\s]+/i.test(value);
}

export function extractEhGalleryUrl(archive) {
  const tags = String(archive?.tags || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
  const sourceTag = tags.find((tag) => /^source\s*:/i.test(tag));
  let raw = sourceTag ? sourceTag.replace(/^source\s*:/i, '').trim() : '';
  if (!raw) raw = String(archive?.source || archive?.source_url || archive?.url || '').trim();
  if (!raw) return '';
  if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
  try {
    const parsed = new URL(raw);
    if (!/(^|\.)(exhentai\.org|e-hentai\.org)$/i.test(parsed.hostname)) return '';
    const match = parsed.pathname.match(/^\/g\/(\d+)\/([0-9a-f]+)\/?/i);
    if (!match) return '';
    return `https://${parsed.hostname}/g/${match[1]}/${match[2]}/`;
  } catch {
    return '';
  }
}

export async function removeEhFavorite({ galleryUrl, cookie, workerUrl, token }) {
  if (!galleryUrl) return { skipped: true, reason: 'missing-url' };
  if (!cookie) return { skipped: true, reason: 'missing-cookie' };
  if (!workerUrl) return { skipped: true, reason: 'missing-worker' };
  if (!token) return { skipped: true, reason: 'missing-token' };

  const endpoint = workerUrl.replace(/\/$/, '') + '/favorite';
  const headers = { 'Content-Type': 'application/json', 'x-sync-token': token };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ mode: 'remove', url: galleryUrl, cookie }),
  });

  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.detail || data?.error || `E-Hentai 收藏夹同步删除失败 (HTTP ${res.status})`);
  }
  return data || { ok: true };
}
