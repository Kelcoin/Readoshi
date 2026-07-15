import { ARCHIVE_PROGRESS_VISIBILITY, normalizeArchiveProgressVisibility } from './archiveProgress';

export const READER_SETTINGS_KEY = 'lrr_reader_settings';

export const DEFAULT_READER_SETTINGS = Object.freeze({
  direction: 'ltr', preloadCount: 3, autoTurnInterval: 5, autoTurnActive: false,
  ehEnabled: false, ehCookie: '', ehMinScore: -100, ehMaxComments: 30,
  ehSortMethod: 'posted', ehSortOrder: 'desc',
  readingLayout: 'single', doublePageEnabled: false,
  scaleMode: 'fit-screen', cropBordersEnabled: false,
  splitWidePagesEnabled: false, rotateWidePagesEnabled: false,
  webtoonGap: 0, doublePageGap: 8,
  pageIndicatorVisibilityMode: 'auto',
  progressBarVisibility: ARCHIVE_PROGRESS_VISIBILITY.HISTORY,
});

const allowed = {
  direction: ['ltr', 'rtl'], readingLayout: ['single', 'double', 'webtoon', 'auto'],
  scaleMode: ['fit-screen', 'fit-width', 'fit-height', 'original'],
  pageIndicatorVisibilityMode: ['pinned', 'hidden', 'auto'],
};

export function normalizeReaderSettings(value = {}) {
  const next = { ...DEFAULT_READER_SETTINGS, ...(value && typeof value === 'object' ? value : {}) };
  if (value?.doublePageEnabled && (!value.readingLayout || value.readingLayout === 'single')) next.readingLayout = 'double';
  for (const [key, choices] of Object.entries(allowed)) {
    if (!choices.includes(next[key])) next[key] = DEFAULT_READER_SETTINGS[key];
  }
  for (const key of ['doublePageEnabled', 'cropBordersEnabled', 'splitWidePagesEnabled', 'rotateWidePagesEnabled']) {
    next[key] = Boolean(next[key]);
  }
  next.preloadCount = Math.max(0, Math.min(10, Number(next.preloadCount) || 0));
  next.webtoonGap = Math.max(0, Math.min(64, Number(next.webtoonGap) || 0));
  next.doublePageGap = Math.max(0, Math.min(64, Number(next.doublePageGap) || 0));
  next.doublePageEnabled = next.readingLayout === 'double';
  next.progressBarVisibility = normalizeArchiveProgressVisibility(next.progressBarVisibility);
  if (next.splitWidePagesEnabled) next.rotateWidePagesEnabled = false;
  return next;
}

export function prepareReaderSettingsForArchiveChange(value = {}) {
  return normalizeReaderSettings({ ...(value && typeof value === 'object' ? value : {}), autoTurnActive: false });
}
