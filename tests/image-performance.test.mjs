import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import * as cachePolicy from '../src/lib/cachePolicy.js';
import * as imageLoadQueue from '../src/lib/imageLoadQueue.js';
import * as readerLayout from '../src/lib/readerLayout.js';
import * as readerPreviewDecode from '../src/lib/readerPreviewDecode.js';
import * as readerSettings from '../src/lib/readerSettings.js';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('reader preloads remote pages as blobs without decoding throwaway images', () => {
  const source = read('src/pages/Reader.jsx');
  assert.match(source, /import \{[^}]*primeImage[^}]*\} from '\.\.\/lib\/imageCache';/s);
  assert.doesNotMatch(source, /function primePageImage|new Image\(\)[\s\S]{0,300}\.decode\(\)/);
  assert.match(source, /primeImage\(normalized/);
});

test('decode window includes current spread and one spread on each side', () => {
  assert.equal(typeof readerLayout.getReaderDecodeWindow, 'function');
  const spreads = readerLayout.buildReaderSpreads({ pageCount: 8, doublePage: true });
  assert.deepEqual(
    readerLayout.getReaderDecodeWindow(spreads, 2).map((spread) => spread.map((unit) => unit.pageIndex)),
    [[1, 2], [3, 4], [5, 6]],
  );
});

test('normal paged reader keeps adjacent decode-window images mounted offscreen', () => {
  const source = read('src/pages/Reader.jsx');
  assert.match(source, /const adjacentDecodePageIndices =/);
  assert.match(source, /adjacentDecodePageIndices\.map\([\s\S]*?<PageImage[\s\S]*?serializedDecode/);
});

test('image decode queue runs one task at a time', async () => {
  assert.equal(typeof imageLoadQueue.createImageDecodeQueue, 'function');
  const queue = imageLoadQueue.createImageDecodeQueue();
  const events = [];
  let releaseFirst;
  const first = queue.schedule('first', async () => {
    events.push('first:start');
    await new Promise((resolve) => { releaseFirst = resolve; });
    events.push('first:end');
  });
  const second = queue.schedule('second', async () => events.push('second:start'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['first:start']);
  releaseFirst();
  await Promise.all([first.promise, second.promise]);
  assert.deepEqual(events, ['first:start', 'first:end', 'second:start']);
});

test('image decode queue cancels stale queued and active work', async () => {
  const queue = imageLoadQueue.createImageDecodeQueue();
  let activeSignal;
  let staleStarted = false;
  const active = queue.schedule('active', async (signal) => {
    activeSignal = signal;
    await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
  });
  const stale = queue.schedule('stale', async () => { staleStarted = true; });
  await new Promise((resolve) => setImmediate(resolve));
  stale.cancel();
  active.cancel();
  await Promise.allSettled([active.promise, stale.promise]);
  assert.equal(activeSignal.aborted, true);
  assert.equal(staleStarted, false);
});

test('memory image cache policy uses byte budget and oldest-first eviction', () => {
  assert.equal(typeof cachePolicy.resolveMemoryImageCacheBudget, 'function');
  assert.equal(typeof cachePolicy.selectMemoryImageCacheEvictions, 'function');
  assert.equal(cachePolicy.resolveMemoryImageCacheBudget(2), 64 * 1024 ** 2);
  assert.equal(cachePolicy.resolveMemoryImageCacheBudget(8), 192 * 1024 ** 2);
  assert.deepEqual(cachePolicy.selectMemoryImageCacheEvictions([
    { key: 'old', size: 40, lastAccessedAt: 1 },
    { key: 'new', size: 40, lastAccessedAt: 2 },
  ], 50, 100), ['old']);
});

test('reader preview decode only downsamples genuinely oversized images', () => {
  assert.equal(typeof cachePolicy.resolveReaderPreviewDecodeSize, 'function');
  assert.deepEqual(cachePolicy.resolveReaderPreviewDecodeSize({
    width: 8000,
    height: 12000,
    viewportWidth: 1200,
    viewportHeight: 800,
    devicePixelRatio: 2,
  }), { width: 2160, height: 3240 });
  assert.equal(cachePolicy.resolveReaderPreviewDecodeSize({
    width: 4000,
    height: 5000,
    viewportWidth: 1200,
    viewportHeight: 800,
    devicePixelRatio: 2,
  }), null);
  assert.equal(cachePolicy.resolveReaderPreviewDecodeSize({
    width: 3000,
    height: 5000,
    viewportWidth: 390,
    viewportHeight: 844,
    devicePixelRatio: 3,
  }), null);
});

test('reader preview decode is wired to zoom fallback and reader settings', () => {
  const reader = read('src/pages/Reader.jsx');
  const settings = read('src/lib/readerSettings.js');
  assert.match(settings, /optimizedImageDecodeEnabled:\s*true/);
  assert.match(reader, /settings\.optimizedImageDecodeEnabled/);
  assert.match(reader, /zoomScale\s*>\s*1\.0/);
  assert.match(reader, /getReaderPreviewSource/);
  assert.equal(readerSettings.normalizeReaderSettings({}).optimizedImageDecodeEnabled, true);
  assert.equal(readerSettings.normalizeReaderSettings({ optimizedImageDecodeEnabled: false }).optimizedImageDecodeEnabled, false);
});

test('reader preview decoder reads source geometry and falls back when resize decode is unavailable', async () => {
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(png.buffer);
  view.setUint32(16, 8000);
  view.setUint32(20, 12000);
  assert.deepEqual(readerPreviewDecode.readImageDimensions(png.buffer), { width: 8000, height: 12000 });
  assert.deepEqual(await readerPreviewDecode.getReaderPreviewSource('blob:source', {
    sourceSize: { width: 8000, height: 12000 },
  }), { src: 'blob:source', width: 8000, height: 12000, isPreview: false });
});

test('decoded previews become visible atomically and immersive promotion keeps decode identity', () => {
  const reader = read('src/pages/Reader.jsx');
  assert.match(reader, /className=\{isReady && !serializedDecode \? 'reader-content-fade-in' : undefined\}/);
  assert.match(reader, /target\.dataset\.readerUnit = source\.dataset\.readerUnit/);
  assert.match(reader, /target\.dataset\.decodePrecision = source\.dataset\.decodePrecision/);
  assert.match(reader, /target\.dataset\.sourceWidth = source\.dataset\.sourceWidth/);
  assert.match(reader, /target\.dataset\.sourceHeight = source\.dataset\.sourceHeight/);
});

test('immersive click and automatic page turns promote an already decoded adjacent spread', () => {
  const reader = read('src/pages/Reader.jsx');
  assert.match(reader, /const promoteImmersiveTarget = useCallback/);
  assert.match(reader, /const promoted = promoteImmersiveTarget\(bounded, targetSplitPart\)/);
  assert.match(reader, /status: visibleImmediately \|\| bounded === prev\.visibleIndex \? 'ready' : 'loading'/);
});

test('image sources decode offscreen before replacing a visible bitmap', async () => {
  assert.equal(typeof readerPreviewDecode.decodeImageSource, 'function');
  const events = [];
  const image = {
    complete: false,
    naturalWidth: 0,
    naturalHeight: 0,
    set src(value) { events.push(`src:${value}`); },
    async decode() {
      events.push('decode:start');
      this.complete = true;
      this.naturalWidth = 1600;
      this.naturalHeight = 2400;
      events.push('decode:end');
    },
  };
  const result = await readerPreviewDecode.decodeImageSource('blob:ready', {
    imageFactory: () => image,
  });
  assert.deepEqual(events, ['src:blob:ready', 'decode:start', 'decode:end']);
  assert.equal(result.width, 1600);
  assert.equal(result.height, 2400);
  assert.equal(result.image, image);
});

test('paged readers retain the visible frame until the replacement spread is decoded', () => {
  const reader = read('src/pages/Reader.jsx');
  assert.match(reader, /currentSpread\.map\(\(unit, slotIndex\) =>/);
  assert.match(reader, /key=\{`spread-slot:\$\{slotIndex\}`\}/);
  assert.match(reader, /const decoded = await decodeImageSource\(resolved\.src/);
  assert.match(reader, /loadSpread\(\[imgCurrRef, imgCurrSecondRef\], activeSpread, IMAGE_LOAD_PRIORITY\.CRITICAL, true, true\)/);
  assert.match(reader, /const commits = await Promise\.all/);
  assert.match(reader, /commits\.forEach\(\(commit\) =>[\s\S]{0,80}commit\(\)/);
});

test('swipe completion never clears the visible bitmap before its replacement is ready', () => {
  const reader = read('src/pages/Reader.jsx');
  assert.doesNotMatch(
    reader,
    /const previewImg = deltaX[\s\S]*?currImg\.src = ''[\s\S]*?commitPageTargetRef\.current/,
  );
});

test('webtoon pages always use offscreen decode even when preview downsampling is disabled', () => {
  const reader = read('src/pages/Reader.jsx');
  const webtoonRenderers = [...reader.matchAll(/<PageImage[\s\S]{0,700}?className="reader-webtoon-page-image"|className="reader-webtoon-page"[\s\S]{0,700}?<PageImage/g)];
  assert.ok(webtoonRenderers.length >= 1);
  assert.doesNotMatch(reader, /serializedDecode=\{settings\.optimizedImageDecodeEnabled\}/);
});

test('border crop is measured from the decoded replacement before it is displayed', () => {
  const reader = read('src/pages/Reader.jsx');
  assert.match(reader, /detectImageBorderInsets\(decoded\.image\)/);
});
