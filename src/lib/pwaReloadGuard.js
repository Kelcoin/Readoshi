const RELOAD_CLAIM_KEY = 'lrr_pwa_reload_claim_v1';

export function getServiceWorkerVersion(scriptURL) {
  try {
    return new URL(scriptURL, 'https://local.invalid').searchParams.get('v') || 'unknown';
  } catch {
    return 'unknown';
  }
}

export function claimPwaReload(storage, version, now = Date.now()) {
  const nextVersion = String(version || 'unknown');
  let previous = null;
  try {
    previous = JSON.parse(storage.getItem(RELOAD_CLAIM_KEY) || 'null');
  } catch {}
  if (previous?.version === nextVersion) return false;
  try {
    storage.setItem(RELOAD_CLAIM_KEY, JSON.stringify({ version: nextVersion, ts: now }));
    return true;
  } catch {
    return false;
  }
}
