import assert from 'node:assert/strict';
import fs from 'node:fs';

const reader = fs.readFileSync(new URL('../src/pages/Reader.jsx', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');

assert.match(reader, /readerRenderReducer/, 'Reader must use the resource-stage reducer');
assert.match(reader, /useReducer\(/, 'Reader must own one instance-scoped render pipeline');
assert.match(reader, /new AbortController\(\)/, 'Reader bootstrap must own abortable requests');
assert.match(
  reader,
  /const metadataPromise =[\s\S]*const manifestPromise =[\s\S]*Promise\.allSettled\(\[metadataPromise, manifestPromise\]\)/,
  'metadata and manifest must start independently before their join',
);
assert.match(
  reader,
  /loadReaderBootstrapResource\([\s\S]*getArchive\(archiveId, \{ signal: controller\.signal \}\)[\s\S]*loadReaderBootstrapResource\([\s\S]*getArchiveFiles\(archiveId, \{ signal: controller\.signal \}\)/,
  'metadata and manifest must use bounded transient-failure retries',
);
assert.doesNotMatch(reader, /extractArchive\(archiveId/, 'Reader must use the documented files endpoint instead of the removed legacy extraction fallback');
assert.doesNotMatch(reader, /if \(loading\)\s*\{\s*return <ReaderStageSkeleton/, 'metadata loading must not replace the whole Reader tree');
assert.doesNotMatch(reader, /if \(loadingPages && pages\.length === 0\)/, 'manifest loading must not replace the whole Reader tree');
assert.match(reader, /const currentPageReady =/, 'secondary work needs a current-page readiness gate');
assert.match(reader, /currentPageReady\) setSecondaryContentReady\(true\)/, 'current-page readiness must release secondary work once');
assert.match(reader, /viewMode === 'normal' && secondaryContentReady && archive/, 'recommendations must wait for the current page without unmounting during later turns');
assert.match(reader, /canRenderPage\s*\?/, 'the stage must replace its skeleton independently');
assert.match(reader, /canShowPageCount \? `\$\{normalTargetIndex \+ 1\} \/ \$\{pages\.length\}` : '— \/ —'/, 'page count must appear as soon as the manifest is ready');
assert.match(reader, /status=\{renderState\.manifest\.status === 'error' \? 'error' : \(renderState\.manifest\.status === 'ready' \? 'empty' : 'loading'\)\}/, 'an empty ready manifest needs a terminal empty state');
assert.match(reader, /archiveRef\.current = meta;[\s\S]*setArchive\(meta\)/, 'metadata ownership must update synchronously before StrictMode replay');
assert.match(reader, /pagesRef\.current = extractedPages;[\s\S]*setPages\(extractedPages\)/, 'manifest ownership must update synchronously before StrictMode replay');
assert.match(reader, /const distance = Math\.abs\(index - currentIndex\)/, 'Webtoon pages must derive priority from current-page distance');
assert.match(reader, /distance === 0 \? handlePageVisualReady : undefined/, 'the current Webtoon page must release the progressive pipeline');
assert.match(reader, /distance === 0[\s\S]*IMAGE_LOAD_PRIORITY\.CRITICAL[\s\S]*distance === 1[\s\S]*IMAGE_LOAD_PRIORITY\.ADJACENT[\s\S]*IMAGE_LOAD_PRIORITY\.PRELOAD/, 'Webtoon image priorities must decrease with distance');
assert.match(reader, /role="status"\s+aria-live="polite"/, 'progressive async slots must announce updates politely');
assert.match(styles, /\.reader-stage-slot\s*\{[\s\S]*transition:\s*opacity[^;]*,\s*transform/, 'slot reveal must animate compositor-safe properties only');
const slotReveal = styles.match(/@keyframes readerStageSlotReveal\s*\{[\s\S]*?\n\}/)?.[0] || '';
assert.ok(slotReveal, 'progressive slots need their own reveal keyframes');
assert.doesNotMatch(slotReveal, /filter:/, 'progressive slot reveal must not animate filters');
assert.match(styles, /\.reader-stage-retry:focus-visible/, 'retry action needs a visible keyboard focus state');
assert.match(
  styles,
  /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.reader-stage-slot[\s\S]*\.reader-shell-pulse[\s\S]*animation:\s*none/,
  'Reader progressive and pulse motion must be disabled for reduced motion',
);
assert.match(styles, /\[data-ios="true"\] \.reader-stage-slot[\s\S]*animation:\s*none/, 'iOS must not replay progressive slot animation');

console.log('Reader progressive shell checks passed');
