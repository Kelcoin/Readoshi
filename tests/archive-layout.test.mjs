import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as readerUiState from '../src/lib/readerUiState.js';
import * as horizontalScroller from '../src/lib/horizontalScroller.js';

const read = (path) => readFileSync(path, 'utf8');

test('archive grid layout uses CSS flex wrapping without JavaScript centering observers', () => {
  const css = read('src/index.css');
  const grid = read('src/components/ArchiveGrid.jsx');
  const pagination = read('src/lib/archivePagination.js');
  assert.equal(/\.archive-grid\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;[^}]*justify-content:\s*center;/s.test(css), true);
  assert.match(css, /\.archive-grid\s*\{[^}]*align-items:\s*flex-start;/s);
  assert.match(css, /\.archive-grid\s*>\s*\.archive-card-wrap\.is-wide\s*\{[^}]*flex:\s*0\s+1\s+316px;[^}]*width:\s*min\(316px,\s*100%\);[^}]*max-width:\s*100%;/s);
  assert.doesNotMatch(grid, /observeArchiveGridLayout/);
  assert.doesNotMatch(pagination, /style\.translate|observeArchiveGridLayout/);
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
