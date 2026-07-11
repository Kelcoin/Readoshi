import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReaderSettings } from './readerSettings.js';

test('normalizes old and conflicting reader settings', () => {
  const value = normalizeReaderSettings({ readingLayout: 'webtoon', doublePageEnabled: true, splitWidePagesEnabled: true, rotateWidePagesEnabled: true });
  assert.equal(value.doublePageEnabled, false);
  assert.equal(value.rotateWidePagesEnabled, false);
  assert.equal(value.pageIndicatorVisibilityMode, 'auto');
});
