export const THEME_STORAGE_KEY = 'lrr_theme_mode';
export const THEME_MODES = ['auto', 'dark', 'light'];

export function normalizeThemeMode(mode) {
  return THEME_MODES.includes(mode) ? mode : 'auto';
}

export function getSystemPrefersDark() {
  return !!globalThis.matchMedia?.('(prefers-color-scheme: dark)')?.matches;
}

export function resolveThemeMode(mode, systemPrefersDark = getSystemPrefersDark()) {
  const normalized = normalizeThemeMode(mode);
  if (normalized !== 'auto') return normalized;
  return systemPrefersDark ? 'dark' : 'light';
}

export function getNextThemeMode(mode) {
  const index = THEME_MODES.indexOf(mode);
  if (index < 0) return 'auto';
  return THEME_MODES[(index + 1) % THEME_MODES.length];
}

export function readStoredThemeMode(storage = globalThis.localStorage) {
  try {
    return normalizeThemeMode(storage?.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'auto';
  }
}

export function writeStoredThemeMode(mode, storage = globalThis.localStorage) {
  const normalized = normalizeThemeMode(mode);
  try {
    storage?.setItem(THEME_STORAGE_KEY, normalized);
  } catch {}
  return normalized;
}

export function applyThemeMode(mode, options = {}) {
  const root = options.root || globalThis.document?.documentElement;
  const normalized = normalizeThemeMode(mode);
  const resolved = resolveThemeMode(normalized, options.systemPrefersDark);
  if (root?.dataset) {
    root.dataset.themeMode = normalized;
    root.dataset.theme = resolved;
  }
  if (root?.style) root.style.colorScheme = resolved;
  return resolved;
}

export function watchSystemTheme(onChange) {
  const media = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
  if (!media) return () => {};
  const listener = () => onChange?.(media.matches);
  if (media.addEventListener) {
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }
  media.addListener?.(listener);
  return () => media.removeListener?.(listener);
}
