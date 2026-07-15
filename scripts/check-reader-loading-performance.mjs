import assert from 'node:assert/strict';
import fs from 'node:fs';

const reader = fs.readFileSync(new URL('../src/pages/Reader.jsx', import.meta.url), 'utf8');
const home = fs.readFileSync(new URL('../src/pages/Home.jsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
const primePageImageSource = reader.match(/async function primePageImage[\s\S]*?\n}\n\nfunction getNormalReaderFrameHeight/)?.[0] || '';

assert.doesNotMatch(reader, /pageLoadingProgress/);
assert.doesNotMatch(reader, /pageLoadPhase\.progress/);
assert.doesNotMatch(reader, /const decoded = new Image\(\)/);
assert.doesNotMatch(reader, /ensureImageDecoded/);
assert.match(reader, /height: '2px'/);
assert.match(reader, /scheduleZoomTransform/);
assert.match(reader, /zoomTransformFrameRef/);
assert.doesNotMatch(reader, /MAX_ADJACENT_DECODE_PIXELS/);
assert.doesNotMatch(reader, /currentPixels/);
assert.match(reader, /void loadImg\(imgLeftRef, pages\[prevIdx\], prevIdx, IMAGE_LOAD_PRIORITY\.ADJACENT\)/);
assert.match(reader, /void loadImg\(imgRightRef, pages\[nextIdx\], nextIdx, IMAGE_LOAD_PRIORITY\.ADJACENT\)/);
assert.ok(
  reader.indexOf('loadImg(imgCurrRef, pages[idx], idx, IMAGE_LOAD_PRIORITY.CRITICAL, true)')
    < reader.indexOf('loadImg(imgLeftRef, pages[prevIdx], prevIdx, IMAGE_LOAD_PRIORITY.ADJACENT)'),
  'immersive neighbors must be scheduled only after the current-page request',
);
assert.match(reader, /image\.dataset\.pageIndex = String\(pageIndex\)/, 'immersive image slots must record their decoded page');
assert.match(reader, /previewImg\.dataset\.pageIndex === String\(targetIndex\)/, 'swipe promotion must reject stale adjacent slots');
assert.match(reader, /onNetworkStart\?\.\(\)[\s\S]*?fetch\(normalized/, 'loading status must start only at the real network boundary');
assert.match(reader, /const \[networkPending, setNetworkPending\] = useState\(false\)/, 'page loading UI must track network separately from decode');
assert.match(reader, /networkPending[\s\S]*?setTimeout\(\(\) => setShowLoadingStatus\(true\), 180\)/, 'slow-network status must retain the approved delay');
assert.match(primePageImageSource, /new Image\(\)[\s\S]*?await image\.decode\(\)/, 'normal-mode adjacent priming must predecode images');
assert.match(reader, /role="status" aria-live="polite"/);
assert.match(reader, /setThumbState\(\(state\) => state === 'queued' \? state : 'loading'\)/);

assert.match(css, /\.settings-hint-bubble[\s\S]*?background: #1c1e24;/);
assert.match(css, /:root\[data-theme="light"\] \.settings-hint-bubble[\s\S]*?background: #fff;/);
assert.match(css, /@keyframes archive-wide-reveal/);
assert.match(css, /\.archive-card-wrap\.is-wide > \.archive-card-shell[\s\S]*?animation: archive-wide-reveal/);
assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.archive-card-wrap\.is-wide > \.archive-card-shell/);

assert.match(home, /作用：将横版或方形封面裁成统一的竖向比例。/);
assert.match(home, /条件：Worker 端点必须是可访问的 HTTPS 地址。/);

console.log('reader loading/performance checks passed');
