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
  const workflow = read('.github/workflows/android-apk.yml');
  assert.doesNotMatch(vite, /secure:\s*false/);
  assert.doesNotMatch(vite, /wildcards/);
  assert.match(vite, /VITE_LRR_PROXY_TARGET/);
  assert.match(workflow, /npm ci --no-audit --no-fund/);
  assert.equal(fs.existsSync(new URL('../package-lock.json', import.meta.url)), true);
});

test('login import feedback stays outside the height-limited form and expires', () => {
  const app = read('src/App.jsx');
  const css = read('src/index.css');
  assert.match(app, /className="login-stack-notice"/);
  assert.match(app, /setTimeout\(\(\) => setLoginNotice\(null\), 3000\)/);
  assert.match(css, /\.login-stack-notice\s*\{[^}]*width:\s*100%/s);
});

test('wide archive cards reserve two grid tracks without dense backfill', () => {
  const css = read('src/index.css');
  assert.match(css, /\.archive-grid\s*\{[^}]*grid-auto-flow:\s*row;/s);
  assert.match(css, /\.archive-grid\s*>\s*\.archive-card-wrap\.is-wide\s*\{[^}]*grid-column:\s*span 2\s*!important;/s);
  assert.match(css, /\.archive-grid\s*>\s*\.archive-card-wrap\.is-wide\s*>\s*\.archive-card-shell\s*\{[^}]*width:\s*100%\s*!important;/s);
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
