import assert from 'node:assert/strict';
import test from 'node:test';
import * as pagination from '../src/lib/archivePagination.js';
import * as readerUiState from '../src/lib/readerUiState.js';
import * as horizontalScroller from '../src/lib/horizontalScroller.js';

const container = { left: 0, width: 640 };

test('centers every incomplete visual row and leaves full rows unchanged', () => {
  assert.equal(typeof pagination.getArchiveRowCentering, 'function');
  const result = pagination.getArchiveRowCentering(container, [
    { top: 0, left: 0, right: 150, span: 1 },
    { top: 0, left: 160, right: 310, span: 1 },
    { top: 300, left: 0, right: 150, span: 1 },
    { top: 300, left: 160, right: 310, span: 1 },
    { top: 300, left: 320, right: 470, span: 1 },
    { top: 300, left: 480, right: 630, span: 1 },
    { top: 600, left: 0, right: 310, span: 2 },
  ], 4);

  assert.deepEqual(result.translations, [
    { index: 0, offset: 165 },
    { index: 1, offset: 165 },
    { index: 6, offset: 165 },
  ]);
});

test('removes centering when scrolling fills a formerly incomplete row', () => {
  assert.equal(typeof pagination.getArchiveRowCentering, 'function');
  const result = pagination.getArchiveRowCentering(container, [
    { top: 0, left: 0, right: 150, span: 1 },
    { top: 0, left: 160, right: 310, span: 1 },
    { top: 0, left: 320, right: 470, span: 1 },
    { top: 0, left: 480, right: 630, span: 1 },
  ], 4);

  assert.deepEqual(result.translations, []);
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
