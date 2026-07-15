import assert from 'node:assert/strict';
import fs from 'node:fs';

const progressModuleUrl = new URL('../src/lib/archiveProgress.js', import.meta.url);
const progressModule = await import(progressModuleUrl.href);
const {
  ARCHIVE_PROGRESS_VISIBILITY,
  getArchiveProgressPercent,
  normalizeArchiveProgressVisibility,
  readArchiveProgressVisibility,
  shouldShowArchiveProgress,
} = progressModule;

assert.equal(normalizeArchiveProgressVisibility('bad-value'), ARCHIVE_PROGRESS_VISIBILITY.HISTORY);
assert.equal(readArchiveProgressVisibility({ getItem: () => JSON.stringify({ progressBarVisibility: 'global' }) }), ARCHIVE_PROGRESS_VISIBILITY.GLOBAL);
assert.equal(shouldShowArchiveProgress(ARCHIVE_PROGRESS_VISIBILITY.DISABLED, true), false);
assert.equal(shouldShowArchiveProgress(ARCHIVE_PROGRESS_VISIBILITY.HISTORY, true), true);
assert.equal(shouldShowArchiveProgress(ARCHIVE_PROGRESS_VISIBILITY.HISTORY, false), false);
assert.equal(shouldShowArchiveProgress(ARCHIVE_PROGRESS_VISIBILITY.GLOBAL, false), true);
assert.equal(getArchiveProgressPercent({ pagecount: 100, progress: 37 }), 37);
assert.equal(getArchiveProgressPercent({ total: 58, page: 17 }), 29);
assert.equal(getArchiveProgressPercent({ pagecount: 0, progress: 8 }), null);
assert.equal(getArchiveProgressPercent({}, { progressPercent: 135 }), 100);

const home = fs.readFileSync(new URL('../src/pages/Home.jsx', import.meta.url), 'utf8');
const reader = fs.readFileSync(new URL('../src/pages/Reader.jsx', import.meta.url), 'utf8');
const card = fs.readFileSync(new URL('../src/components/ArchiveCard.jsx', import.meta.url), 'utf8');
const history = fs.readFileSync(new URL('../src/pages/HistoryPage.jsx', import.meta.url), 'utf8');
const watchlist = fs.readFileSync(new URL('../src/pages/WatchlistPage.jsx', import.meta.url), 'utf8');
const recommendations = fs.readFileSync(new URL('../src/components/Recommendations.jsx', import.meta.url), 'utf8');
const deduplicate = fs.readFileSync(new URL('../src/pages/DeduplicatePage.jsx', import.meta.url), 'utf8');
const settings = fs.readFileSync(new URL('../src/lib/readerSettings.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');

assert.match(settings, /progressBarVisibility: ARCHIVE_PROGRESS_VISIBILITY\.HISTORY/);
assert.match(home, />显示进度条<\/SettingHint>/);
assert.match(home, /label: '禁止'.*ARCHIVE_PROGRESS_VISIBILITY\.DISABLED/s);
assert.match(home, /label: '仅历史记录'.*ARCHIVE_PROGRESS_VISIBILITY\.HISTORY/s);
assert.match(home, /label: '全局'.*ARCHIVE_PROGRESS_VISIBILITY\.GLOBAL/s);
assert.match(home, /showProgressBar=\{showGlobalArchiveProgress\}/);
assert.match(home, /showProgressBar=\{showHistoricalArchiveProgress\}/);
assert.match(home, /reserveProgressSpace=\{reserveGlobalProgressSpace\}/);
assert.match(home, /<SkeletonCard key=\{`hsk-\$\{i\}`\} showProgress=\{showHistoricalArchiveProgress\}/);
assert.match(history, /showProgressBar=\{showHistoricalArchiveProgress\}/);
assert.match(watchlist, /showProgressBar=\{showHistoricalArchiveProgress\}/);
assert.match(recommendations, /showProgressBar=\{showGlobalArchiveProgress\}/);
assert.match(deduplicate, /showProgressBar=\{showGlobalArchiveProgress\}/);
assert.match(card, /reserveProgressSpace = false/);
assert.match(card, /className="archive-card-progress"[\s\S]*?className="archive-card-progress-fill"/);
assert.doesNotMatch(card, /archive-card-progress-border/);
assert.doesNotMatch(css, /\.archive-cover-frame > \.archive-card-progress\s*\{/);
assert.match(css, /\.archive-card-progress\s*\{[^}]*width:\s*100%;[^}]*height:\s*3px;[^}]*margin-top:\s*2px;[^}]*overflow:\s*hidden;/s);
assert.doesNotMatch(css, /\.archive-card-progress-border/);
assert.match(css, /\.archive-card-progress-fill\s*\{[^}]*height:\s*100%;[^}]*border-radius:\s*inherit;[^}]*background:\s*var\(--accent\);/s);
assert.match(card, /const reserveEmptyProgressSpace = reserveProgressSpace && !showProgress/);
assert.match(card, /marginTop: `\$\{\(isMobile \? 4 : 6\) \+ \(reserveEmptyProgressSpace \? 5 : 0\)\}px`/);
assert.match(reader, /progressBarVisibility=\{settings\.progressBarVisibility\}/);
assert.match(reader, /className="reader-archive-progress"/);
assert.match(css, /\.reader-archive-progress\s*\{[^}]*right:\s*0;[^}]*bottom:\s*0;[^}]*left:\s*0;/s);
assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.reader-archive-progress-fill/);

console.log('archive progress visibility checks passed');
