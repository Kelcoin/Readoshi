import test from 'node:test';
import assert from 'node:assert/strict';
import { ARCHIVE_PAGE_SIZE, clampArchivePage, getArchivePageCount, getArchivePageStart, normalizeArchiveBrowseMode } from './archivePagination.js';

test('normalizes archive browse mode', () => {
  assert.equal(normalizeArchiveBrowseMode('paged'), 'paged');
  assert.equal(normalizeArchiveBrowseMode('scroll'), 'scroll');
  assert.equal(normalizeArchiveBrowseMode('other'), 'scroll');
});

test('computes archive page count and start offset', () => {
  assert.equal(ARCHIVE_PAGE_SIZE, 50);
  assert.equal(getArchivePageCount(0), 1);
  assert.equal(getArchivePageCount(51), 2);
  assert.equal(getArchivePageStart(2), 100);
});

test('clamps archive page to available range', () => {
  assert.equal(clampArchivePage(-1, 120), 0);
  assert.equal(clampArchivePage(8, 120), 2);
  assert.equal(clampArchivePage(1, null), 1);
});
