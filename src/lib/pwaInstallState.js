export const PWA_INSTALL_DISMISSED_KEY = 'readoshi_pwa_install_dismissed_v1';

export function isInstallDismissed(storage = globalThis.localStorage) {
  try { return storage?.getItem(PWA_INSTALL_DISMISSED_KEY) === '1'; } catch { return false; }
}
export function dismissInstallPrompt(storage = globalThis.localStorage) {
  try { storage?.setItem(PWA_INSTALL_DISMISSED_KEY, '1'); } catch {}
}

export function isStandaloneDisplay({
  matchMedia = globalThis.matchMedia,
  navigator = globalThis.navigator,
} = {}) {
  try {
    return !!navigator?.standalone || !!matchMedia?.('(display-mode: standalone)')?.matches;
  } catch {
    return false;
  }
}
