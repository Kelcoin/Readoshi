import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as readerUiState from '../src/lib/readerUiState.js';
import * as horizontalScroller from '../src/lib/horizontalScroller.js';
import { getArchiveCardMove, packArchiveGridItems } from '../src/lib/archiveGridLayout.js';

const read = (path) => readFileSync(path, 'utf8');

test('archive grid uses one shared dense packing and flex centering mechanism', () => {
  const css = read('src/index.css');
  const grid = read('src/components/ArchiveGrid.jsx');
  const pagination = read('src/lib/archivePagination.js');
  assert.equal(/\.archive-grid\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;[^}]*justify-content:\s*center;/s.test(css), true);
  assert.match(css, /\.archive-grid\s*\{[^}]*align-items:\s*flex-start;/s);
  assert.match(css, /\.archive-grid\s*>\s*\.archive-card-wrap\.is-wide\s*\{[^}]*flex:\s*0\s+1\s+316px;[^}]*width:\s*min\(316px,\s*100%\);[^}]*max-width:\s*100%;/s);
  assert.match(grid, /packArchiveGridItems/);
  assert.match(grid, /ResizeObserver/);
  assert.doesNotMatch(grid, /observeArchiveGridLayout/);
  assert.doesNotMatch(pagination, /style\.translate|observeArchiveGridLayout/);
});

test('later narrow cards fill an earlier row before a wide card', () => {
  const items = [
    { id: 'a', width: 150 },
    { id: 'b', width: 150 },
    { id: 'wide', width: 316 },
    { id: 'fill', width: 150 },
  ];
  assert.deepEqual(
    packArchiveGridItems(items, 482, 16).map((item) => item.id),
    ['a', 'b', 'fill', 'wide'],
  );
});

test('packing is recalculated when cards append or change width', () => {
  const initial = [
    { id: 'a', width: 150 },
    { id: 'b', width: 150 },
    { id: 'wide', width: 316 },
  ];
  assert.deepEqual(
    packArchiveGridItems(initial, 482, 16).map((item) => item.id),
    ['a', 'b', 'wide'],
  );
  assert.deepEqual(
    packArchiveGridItems([...initial, { id: 'fill', width: 150 }], 482, 16).map((item) => item.id),
    ['a', 'b', 'fill', 'wide'],
  );
  assert.deepEqual(
    packArchiveGridItems(initial.map((item) => (
      item.id === 'wide' ? { ...item, width: 150 } : item
    )), 482, 16).map((item) => item.id),
    ['a', 'b', 'wide'],
  );
});

test('packing responds to container width and leaves unfillable rows intact', () => {
  const items = [
    { id: 'a', width: 150 },
    { id: 'wide', width: 316 },
    { id: 'b', width: 150 },
  ];
  assert.deepEqual(
    packArchiveGridItems(items, 316, 16).map((item) => item.id),
    ['a', 'b', 'wide'],
  );
  assert.deepEqual(
    packArchiveGridItems(items, 482, 16).map((item) => item.id),
    ['a', 'wide', 'b'],
  );
});

test('large one-card rows pack without quadratic scans', () => {
  const items = Array.from({ length: 20_000 }, (_, id) => ({ id, width: 150 }));
  const startedAt = performance.now();
  const packed = packArchiveGridItems(items, 150, 16);
  const elapsed = performance.now() - startedAt;
  assert.equal(packed.length, items.length);
  assert.ok(elapsed < 100, `packing took ${elapsed.toFixed(1)}ms`);
});

test('archive reflow delta ignores stationary cards and tracks position changes', () => {
  assert.equal(
    getArchiveCardMove({ left: 10, top: 20 }, { left: 10.4, top: 20.4 }),
    null,
  );
  assert.deepEqual(
    getArchiveCardMove({ left: 332, top: 100 }, { left: 166, top: 420 }),
    { x: 166, y: -320 },
  );
});

test('archive reflow preserves an in-flight visual offset during another layout change', () => {
  assert.deepEqual(
    getArchiveCardMove(
      { left: 100, top: 20 },
      { left: 300, top: 20 },
      { x: -50, y: 0 },
    ),
    { x: -250, y: 0 },
  );
});

test('archive reflow does not restart an active animation when layout is unchanged', () => {
  assert.equal(
    getArchiveCardMove(
      { left: 100, top: 20 },
      { left: 100, top: 20 },
      { x: -50, y: 0 },
    ),
    null,
  );
});

test('archive grid animates keyed reflow with reduced-motion protection', () => {
  const grid = read('src/components/ArchiveGrid.jsx');
  const card = read('src/components/ArchiveCard.jsx');
  assert.match(card, /data-archive-grid-key=\{archiveGridItemKey \|\| undefined\}/);
  assert.match(grid, /prefers-reduced-motion: reduce/);
  assert.match(grid, /element\.animate\(/);
  assert.match(grid, /element\.offsetLeft/);
  assert.match(grid, /element\.offsetTop/);
  assert.match(
    grid,
    /const logicalMove = getArchiveCardMove[\s\S]*if \(!logicalMove\) continue;[\s\S]*const activeAnimation/,
  );
  assert.match(grid, /duration:\s*220/);
  assert.match(grid, /cubic-bezier\(0\.22, 1, 0\.36, 1\)/);
});

test('drawer virtualization uses content width and includes the row gap', () => {
  assert.equal(typeof readerUiState.getDrawerRowStride, 'function');
  assert.equal(readerUiState.getDrawerRowStride(372), 162.8);
});

test('hover panel closes only after its card leaves horizontal viewport', () => {
  assert.equal(typeof horizontalScroller.isOutsideHorizontalViewport, 'function');
  const viewport = { left: 100, right: 500 };
  assert.equal(horizontalScroller.isOutsideHorizontalViewport({ left: 80, right: 120 }, viewport), false);
  assert.equal(horizontalScroller.isOutsideHorizontalViewport({ left: 20, right: 100 }, viewport), true);
  assert.equal(horizontalScroller.isOutsideHorizontalViewport({ left: 500, right: 650 }, viewport), true);
});

test('archive text selects Japanese font only when Japanese script is present', () => {
  assert.equal(typeof readerUiState.getContentLanguage, 'function');
  assert.equal(readerUiState.getContentLanguage('绫波姬 Valkürie'), 'zh-CN');
  assert.equal(readerUiState.getContentLanguage('母と堕ちていく'), 'ja');
  assert.equal(readerUiState.getContentLanguage('アーカイブ'), 'ja');
});

test('archive count stays beside the heading on narrow screens', () => {
  const css = read('src/index.css');
  const narrowSummaryRule = /@media[^}]*[\s\S]*?\.archive-toolbar-summary\s*\{[^}]*flex-direction:\s*column;/;
  assert.doesNotMatch(css, narrowSummaryRule);
});
