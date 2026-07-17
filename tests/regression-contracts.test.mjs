import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('archive pagination stops by total or empty pages, not a fixed server batch size', () => {
  const home = read('src/pages/Home.jsx');
  const dedupe = read('src/pages/DeduplicatePage.jsx');
  assert.doesNotMatch(home, /nextData\.length < ARCHIVE_PAGE_SIZE/);
  assert.doesNotMatch(dedupe, /BATCH_SIZE\s*=\s*50|data\.length < BATCH_SIZE/);
  assert.match(dedupe, /data\.length === 0/);
  assert.match(dedupe, /all\.length >= total/);
});

test('dedupe scan is scoped and does not rebuild every thumbnail first', () => {
  const source = read('src/pages/DeduplicatePage.jsx');
  assert.match(source, /scopedStorageKey\(DEDUPE_SAVED_RESULT_KEY\)/);
  assert.doesNotMatch(source, /regenerateThumbnails/);
  assert.match(source, /waitForMinionJob/);
});

test('metadata navigation, races, and operations are guarded', () => {
  const source = read('src/pages/MetadataPage.jsx');
  assert.match(source, /setNavigationGuard/);
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /loadSequenceRef/);
  assert.match(source, /if \(busy\) return/);
});

test('Reader recovery reacts to cache fallback and live direction/crop changes', () => {
  const source = read('src/pages/Reader.jsx');
  assert.match(source, /\[assetCacheOnly, viewMode, currentIndex, pages, settings\.direction\]/);
  assert.match(source, /\[applyZoomAtPoint, scheduleZoomTransform, settings\.direction, viewMode\]/);
  assert.match(source, /\[cropBorders, isReady, imgSrc\]/);
  assert.match(source, /keepalive: true/);
});

test('build and proxy hardening are reproducible', () => {
  const vite = read('vite.config.js');
  const workflow = read('.github/workflows/mobile-build.yml');
  assert.doesNotMatch(vite, /secure:\s*false/);
  assert.doesNotMatch(vite, /wildcards/);
  assert.match(vite, /VITE_LRR_PROXY_TARGET/);
  assert.match(workflow, /npm ci --no-audit --no-fund/);
  assert.equal(fs.existsSync(new URL('../package-lock.json', import.meta.url)), true);
});

test('Docker publish runs only when runtime image inputs change', () => {
  const workflow = read('.github/workflows/docker-publish.yml');
  assert.match(workflow, /push:[\s\S]*paths:/);
  assert.doesNotMatch(workflow, /paths-ignore:/);
  for (const input of [
    'src/**',
    'public/**',
    'scripts/app-version.mjs',
    'index.html',
    'package.json',
    'package-lock.json',
    'vite.config.js',
    'Dockerfile',
    '.dockerignore',
    'docker-entrypoint.sh',
    'nginx.conf.template',
  ]) {
    assert.equal(workflow.includes(`- '${input}'`), true, `missing Docker input path: ${input}`);
  }
  assert.doesNotMatch(workflow, /- 'tests\/\*\*'/);
  assert.doesNotMatch(workflow, /- 'worker\.js'/);
});

test('login import feedback stays outside the height-limited form and expires', () => {
  const app = read('src/App.jsx');
  const css = read('src/index.css');
  assert.match(app, /className="login-stack-notice"/);
  assert.match(app, /setTimeout\(\(\) => setLoginNotice\(null\), 3000\)/);
  assert.match(css, /\.login-stack-notice\s*\{[^}]*width:\s*100%/s);
});

test('archive grids combine dense backfill with shared row centering', () => {
  const css = read('src/index.css');
  const home = read('src/pages/Home.jsx');
  const history = read('src/pages/HistoryPage.jsx');
  const watchlist = read('src/pages/WatchlistPage.jsx');
  assert.match(css, /\.archive-grid\s*\{[^}]*grid-auto-flow:\s*row dense;/s);
  assert.match(css, /\.archive-grid\s*>\s*\.archive-card-wrap\.is-wide\s*\{[^}]*grid-column:\s*span 2\s*!important;/s);
  assert.match(css, /\.archive-grid\s*>\s*\.archive-card-wrap\.is-wide\s*>\s*\.archive-card-shell\s*\{[^}]*width:\s*100%\s*!important;/s);
  assert.match(home, /<ArchiveGrid/);
  assert.match(history, /<ArchiveGrid/);
  assert.match(watchlist, /<ArchiveGrid/);
});

test('archive title adapts spacing inside a fixed vertical budget', () => {
  const card = read('src/components/ArchiveCard.jsx');
  assert.match(card, /const ARCHIVE_TITLE_LAYOUTS = \[\s*\{ gap: 12, lineHeight: 1\.45 \},\s*\{ gap: 8, lineHeight: 1\.32 \},\s*\{ gap: 4, lineHeight: 1\.18 \},\s*\];/s);
  assert.match(card, /const ARCHIVE_TITLE_VERTICAL_BUDGET = 51\.7;/);
  assert.match(card, /const ARCHIVE_TITLE_SAFETY_PX = 3;/);
  assert.match(card, /height:\s*`\$\{ARCHIVE_TITLE_VERTICAL_BUDGET - titleLayout\.gap\}px`/);
  assert.match(card, /className="archive-title-slot"/);
  assert.match(card, /height:\s*`\$\{13 \* titleLayout\.lineHeight \* 2 \+ ARCHIVE_TITLE_SAFETY_PX\}px`/);
  assert.match(card, /if \(lines\.length >= 2 && titleLayoutIndex === 0\)/);
  assert.match(card, /lastVisibleLineBottom \+ ARCHIVE_TITLE_SAFETY_PX > titleBox\.bottom/);
});

test('configuration transfer warning and settings layers stay concise and isolated', () => {
  const dialog = read('src/components/ConfigTransferDialog.jsx');
  const home = read('src/pages/Home.jsx');
  const css = read('src/index.css');
  assert.match(dialog, /警告：请勿分享或导入他人配置！/);
  assert.doesNotMatch(dialog, /Base64 编码，不是加密/);
  assert.doesNotMatch(dialog, /message=\{isExport/);
  assert.match(dialog, /className="config-transfer-warning"/);
  assert.match(css, /\.confirm-dialog:has\(\.config-transfer-field\)\s+\.confirm-dialog-title\s*\{[^}]*text-align:\s*center;/s);
  assert.match(css, /\.config-transfer-warning\s*\{[^}]*background:[^}]*text-align:\s*center;/s);
  assert.match(home, /className="settings-panel-footer"/);
  assert.match(css, /\.settings-panel-footer\s*\{[^}]*flex:\s*0 0 auto;[^}]*background:/s);
});

test('home carousels use compact shared vertical padding', () => {
  const home = read('src/pages/Home.jsx');
  assert.match(home, /function getHomeCarouselPadding\(isNarrow\)\s*\{\s*return `12px \$\{isNarrow \? 14 : 20\}px 20px`;/s);
  assert.doesNotMatch(home, /HOME_CAROUSEL_GLOW_PADDING|44px/);
});

test('watchlist glow stays inside compact carousel padding', () => {
  const css = read('src/index.css');
  const glowStart = css.indexOf('.watchlist-card:not(.watchlist-card-plain) .archive-card-shell::before');
  const glowEnd = css.indexOf('.archive-cover-image', glowStart);
  const glowCss = css.slice(glowStart, glowEnd);

  assert.match(glowCss, /0 0 6px[\s\S]*0 0 10px/);
  assert.match(glowCss, /:hover[\s\S]*0 0 8px[\s\S]*0 0 12px/);
  assert.doesNotMatch(glowCss, /0 0 (?:14|16|18|20|30|34|38|42)px/);
});
