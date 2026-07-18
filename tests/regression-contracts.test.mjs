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
  assert.match(source, /\[assetCacheOnly, currentIndex,[^\]]*settings\.direction,[^\]]*webtoonActive\]/);
  assert.match(source, /\[applyZoomAtPoint, scheduleZoomTransform, settings\.direction, viewMode, webtoonActive\]/);
  assert.match(source, /\[cropBorders, isReady, imgSrc\]/);
  assert.match(source, /keepalive: true/);
});

test('Reader layouts share page order while normal and immersive renderers stay separate', () => {
  const source = read('src/pages/Reader.jsx');
  assert.match(source, /buildReaderSpreads/);
  assert.match(source, /imgCurrSecondRef/);
  assert.match(source, /settings\.rotateWidePagesEnabled && wide/);
  assert.match(source, /getContainedHalfFrame\(naturalSize, shellSize, cropSide\)/);
  assert.match(source, /clipPath: cropSide === 'left' \? 'inset\(0 50% 0 0\)'/);
  assert.match(source, /maxWidth: showRotate \? `\$\{shellSize\.height\}px`/);
  assert.match(source, /resizeObserver = new ResizeObserver/);
  assert.match(source, /data-webtoon=\{webtoonActive \? 'true' : 'false'\}/);
  assert.match(source, /onMouseDown=\{webtoonActive \? undefined : handlePointerDown\}/);
  assert.match(source, /!webtoonActive && settings\.autoTurnActive/);
  assert.match(source, /settings\.autoTurnActive, currentIndex, splitPart, currentSpreadIndex/);
  assert.doesNotMatch(source, /splitWide=\{settings\.splitWidePagesEnabled\}/);
});

test('Reader toolbar has three measured states and page commits preserve transient indicators', () => {
  const reader = read('src/pages/Reader.jsx');
  const css = read('src/index.css');
  assert.match(reader, /resolveReaderToolbarMode/);
  assert.match(reader, /data-mode=\{toolbarMode\}/);
  assert.match(reader, /toolbarMode !== 'mobile'/);
  assert.match(css, /\.reader-toolbar\[data-mode="icons"\][\s\S]*\.reader-toolbar-label/);
  assert.match(css, /\.reader-toolbar\[data-mode="mobile"\][\s\S]*\.reader-toolbar-label/);
  assert.match(reader, /gridTemplateColumns: 'minmax\(0, 1fr\) auto minmax\(0, 1fr\)'/);
  assert.match(reader, /toolbarMode !== 'mobile'[\s\S]*className="reader-toolbar-title"[\s\S]*position: 'absolute',[\s\S]*left: '50%',[\s\S]*transform: 'translate\(-50%, -50%\)'/);
  assert.match(reader, /getCenteredToolbarTitleWidth/);
  assert.match(reader, /--reader-toolbar-title-width/);
  assert.match(reader, /const titleContent = title\?\.querySelector\('\.reader-toolbar-title-content'\)/);
  assert.match(reader, /Math\.ceil\(titleContent\.getBoundingClientRect\(\)\.width\)/);
  assert.match(reader, /className="reader-toolbar-title-content"/);
  assert.doesNotMatch(reader, /Math\.min\(Math\.max\(title\.scrollWidth, 80\), 240\)/);
  assert.doesNotMatch(reader, /title \? Math\.max\(title\.scrollWidth, 80\)/);
  assert.match(reader, /reader-toolbar-group-left" style=\{\{[^}]*gridColumn: '1'/);
  assert.match(reader, /reader-toolbar-group-right" style=\{\{[^}]*gridColumn: '3'/);
  assert.match(reader, /pageIndicatorTransientActiveRef\.current[\s\S]*checkIndicatorOverlap\(true\)/);
  assert.match(reader, /useReaderToolbarMode\(isMobile, viewMode\)/);
  assert.match(reader, /\[isMobile, layoutKey, mode\]/);
  assert.match(reader, /viewMode === 'normal' && \([\s\S]*className="reader-toolbar"[\s\S]*position: 'sticky',[\s\S]*top: 0/);
});

test('Reader auto layout prioritizes scrolling and dynamically measures the reader container', () => {
  const reader = read('src/pages/Reader.jsx');
  assert.match(reader, /resolveAutoReadingLayout/);
  assert.match(reader, /effectiveReadingLayout/);
  assert.match(reader, /new ResizeObserver\(updateReaderContainerSize\)/);
  assert.match(reader, /doublePage: effectiveReadingLayout === 'double'/);
  assert.match(reader, /label: '滚动', value: 'webtoon'/);
  assert.doesNotMatch(reader, /label: 'Webtoon'/);
});

test('reading progress can be cleared from archive menus and the Reader drawer', () => {
  const menu = read('src/components/ArchiveContextMenu.jsx');
  const reader = read('src/pages/Reader.jsx');
  const api = read('src/lib/api.js');
  const actions = read('src/lib/archiveProgressActions.js');
  assert.match(menu, /onClearProgress/);
  assert.ok(menu.indexOf('清除阅读进度') < menu.indexOf('编辑元数据'));
  assert.match(reader, /ToolbarGlyph name="resetProgress"/);
  assert.ok(reader.indexOf('resetProgress') < reader.indexOf('ToolbarGlyph name="metadata"'));
  assert.match(api, /options\.force \? '\?force=1' : ''/);
  assert.match(reader, /await \(lrrProgressChainRef\.current\.get\(id\) \|\| Promise\.resolve\(\)\)/);
  assert.match(reader, /highestLrrQueuedPageRef\.current\.set\(id, 0\);[\s\S]*await \(lrrProgressChainRef\.current\.get\(id\)/);
  assert.match(reader, /hasArchiveProgressMarker/);
  assert.match(reader, /shouldPersistArchiveReadingProgress/);
  assert.match(actions, /clearReaderSnapshot\(id\)/);
});

test('immersive Reader replaces its top toolbar with side-aware corner controls', () => {
  const reader = read('src/pages/Reader.jsx');
  const css = read('src/index.css');
  assert.match(reader, /viewMode === 'normal' && \(\s*<div[\s\S]*data-reader-toolbar/);
  assert.match(reader, /reader-immersive-trigger-left/);
  assert.match(reader, /reader-immersive-trigger-right/);
  assert.match(reader, /reader-immersive-controls/);
  assert.match(reader, /2500/);
  assert.match(reader, /holdImmersiveControls/);
  assert.match(reader, /onPointerLeave=\{\(\) => revealImmersiveControls/);
  assert.match(reader, /onBlur=\{\(\) => revealImmersiveControls/);
  assert.match(reader, /title="退出沉浸模式" aria-label="退出沉浸模式"/);
  assert.match(reader, /ToolbarGlyph name="close"/);
  assert.match(reader, /const immersiveDoublePageGap = Math\.min\(6,/);
  assert.match(reader, /getImmersiveSpreadSlotStyle/);
  assert.match(css, /\.reader-immersive-controls\s*\{[^}]*bottom:\s*calc\(env\(safe-area-inset-bottom, 0px\) \+ 52px\);/s);
  assert.match(css, /\.reader-immersive-controls\[data-visible="true"\]/);
  assert.match(css, /cubic-bezier\(0\.34,\s*1\.56,\s*0\.64,\s*1\)/);
  assert.match(reader, /if \(showDrawer\) return;/);
  assert.match(reader, /onWheel=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(css, /\.reader-immersive-controls\[data-visible="true"\]\s+\.reader-immersive-control-button/);
  assert.match(css, /background:\s*rgba\(18,\s*21,\s*28,\s*0\.[45]\d*\)/);
  assert.match(css, /\.reader-immersive-trigger\s*\{[^}]*width:\s*max\(32px,\s*7vw\);/s);
  assert.match(reader, /\{\['left', 'right'\]\.map\(\(side\) => \(/);
  assert.match(reader, /data-visible=\{immersiveControlsSide === side \? 'true' : 'false'\}/);
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

test('archive title keeps exactly two non-overlapping lines inside a fixed vertical budget', () => {
  const card = read('src/components/ArchiveCard.jsx');
  assert.match(card, /const ARCHIVE_TITLE_LAYOUTS = \[\s*\{ gap: 12, fontSize: 13, lineHeight: 1\.5 \},\s*\{ gap: 8, fontSize: 12\.5, lineHeight: 1\.5 \},\s*\{ gap: 4, fontSize: 12, lineHeight: 1\.5 \},\s*\];/s);
  assert.match(card, /const ARCHIVE_TITLE_VERTICAL_BUDGET = 51\.7;/);
  assert.match(card, /height:\s*`\$\{ARCHIVE_TITLE_VERTICAL_BUDGET - titleLayout\.gap\}px`/);
  assert.match(card, /className="archive-title-slot"/);
  assert.match(card, /fontSize:\s*`\$\{titleLayout\.fontSize\}px`/);
  assert.match(card, /height:\s*`\$\{titleLayout\.fontSize \* titleLayout\.lineHeight \* 2\}px`/);
  assert.match(card, /WebkitLineClamp:\s*2/);
  assert.match(card, /if \(lines\.length < 2\) return;/);
  assert.match(card, /if \(lines\.length >= 2 && titleLayoutIndex === 0\)/);
  assert.match(card, /lastVisibleLineBottom > titleBox\.bottom/);
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

test('progress regression is configured only from the general settings section', () => {
  const home = read('src/pages/Home.jsx');
  const reader = read('src/pages/Reader.jsx');
  const cacheSettings = read('src/components/CacheSettings.jsx');
  const css = read('src/index.css');

  for (const label of ['通用设置', '缓存', '归档显示', '浏览与记录']) {
    assert.match(home, new RegExp(`>${label}<`));
  }
  assert.doesNotMatch(cacheSettings, /允许阅读进度回溯|通用设置/);
  assert.match(home, /allowProgressRegression: checked/);
  assert.match(home, /className="settings-control"/);
  assert.match(home, /className="settings-control settings-toggle-control"/);
  assert.match(css, /\.settings-control\s*\{[^}]*width:\s*128px/s);
  assert.match(css, /\.settings-toggle-control\s*\{[^}]*justify-content:\s*flex-end/s);
  assert.doesNotMatch(reader, />允许阅读进度回溯</);
});

test('history list is the only persisted reading progress source', () => {
  const history = read('src/lib/history.js');
  const progressHelpers = read('src/lib/historyProgressCache.js');
  const archiveActions = read('src/lib/archiveProgressActions.js');
  const metadata = read('src/lib/archiveMetadataCache.js');
  const recommendations = read('src/components/Recommendations.jsx');
  for (const source of [history, progressHelpers, archiveActions]) {
    assert.doesNotMatch(source, /HISTORY_PROGRESS_CACHE_KEY|historyProgressCacheKey|readHistoryProgressCache|writeHistoryProgressCache|mergeCachedHistoryProgress|mergeHistoryProgressCache|purgeHistoryProgress/);
  }
  assert.match(metadata, /progress:\s*Number\(record\.page\) \|\| 0/);
  assert.match(recommendations, /delete sanitized\.page;[\s\S]*delete sanitized\.progress;/);
  assert.match(recommendations, /applyCanonicalHistoryProgress/);
});

test('server-derived recommendation caches are scoped and the retired sync module is gone', () => {
  const home = read('src/pages/Home.jsx');
  const recommendations = read('src/components/Recommendations.jsx');
  assert.match(home, /migrateLegacyStorageKey\(RANDOMS_RECENT_KEY\)/);
  assert.match(recommendations, /scopedStorageKey\(`lrr_rec_cache_v3_/);
  assert.equal(fs.existsSync(new URL('../src/lib/sync.js', import.meta.url)), false);
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

test('image cache falls back to IndexedDB when Cache Storage is unavailable', () => {
  const cache = read('src/lib/imageCache.js');
  const index = read('src/lib/imageCacheIndex.js');
  assert.match(index, /const BLOB_STORE = 'blobs'/);
  assert.match(index, /putBlob\(key, blob\)/);
  assert.match(index, /getBlob\(key\)/);
  assert.match(cache, /imageCacheIndex\.putBlob\(key, blob\)/);
  assert.match(cache, /imageCacheIndex\.getBlob\(key\)/);
  assert.match(cache, /typeof caches === 'undefined'/);
});

test('drawer overview owns archive size and disables scroll anchoring', () => {
  const reader = read('src/pages/Reader.jsx');
  assert.doesNotMatch(reader, /reader-archive-summary/);
  assert.match(reader, /页面总览 · 共\{pages\.length\}页\{archiveSizeLabel \? ` · \$\{archiveSizeLabel\}` : ''\}/);
  assert.match(reader, /overflowAnchor: 'none'/);
});

test('archive tag panel follows cards inside horizontal scrollers and closes offscreen', () => {
  const card = read('src/components/ArchiveCard.jsx');
  assert.match(card, /scrollTarget\.contains\(cardRef\.current\)/);
  assert.match(card, /isOutsideHorizontalViewport\(rect, scrollTarget\.getBoundingClientRect\(\)\)/);
  assert.match(card, /updatePanelPosition\(\)/);
});

test('bundled variable CJK fonts use swap and remeasure archive titles after loading', () => {
  const pkg = JSON.parse(read('package.json'));
  const main = read('src/main.jsx');
  const css = read('src/index.css');
  const card = read('src/components/ArchiveCard.jsx');
  const reader = read('src/pages/Reader.jsx');

  assert.ok(pkg.dependencies['@fontsource-variable/noto-sans-sc']);
  assert.ok(pkg.dependencies['@fontsource-variable/noto-sans-jp']);
  assert.match(main, /@fontsource-variable\/noto-sans-sc\/wght\.css/);
  assert.match(main, /@fontsource-variable\/noto-sans-jp\/wght\.css/);
  assert.match(css, /font-family:\s*'Noto Sans SC Variable'/);
  assert.match(css, /:lang\(ja\)[\s\S]*'Noto Sans JP Variable'/);
  assert.match(card, /document\.fonts\.ready/);
  assert.match(card, /lang=\{archiveLanguage\}/);
  assert.match(reader, /lang=\{getContentLanguage\(archive\?\.title\)\}/);
});

test('EH comments are persistent, timeout-safe, and reject stale requests', () => {
  const comments = read('src/components/EhComments.jsx');
  assert.match(comments, /readEhCommentsCache/);
  assert.match(comments, /writeEhCommentsCache/);
  assert.match(comments, /requestSeqRef/);
  assert.match(comments, /requestAbortRef/);
  assert.match(comments, /20 \* 1000/);
  assert.match(comments, /AbortController/);
  assert.doesNotMatch(comments, /const commentsCache = new Map/);
  assert.doesNotMatch(comments, /cacheKey \+ '::api'/);
  assert.doesNotMatch(comments, /autoRetryTimerRef|autoRetryCountRef/);
});
