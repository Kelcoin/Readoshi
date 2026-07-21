import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getArchiveAddedAt,
  sliceArchiveCatalog,
  sortArchiveCatalog,
} from '../src/lib/archiveCatalog.js';

test('archive catalog sorts stably by added date and title without mutating input', () => {
  const items = [
    { arcid: 'b', title: 'Beta', tags: 'date_added:10' },
    { arcid: 'a', title: 'Alpha', tags: 'date_added:20' },
    { arcid: 'c', title: 'alpha', tags: 'date_added:20' },
  ];

  assert.equal(getArchiveAddedAt({ date_added: 7 }), 7);
  assert.deepEqual(sortArchiveCatalog(items, 'date_added', 'desc').map((item) => item.arcid), ['a', 'c', 'b']);
  assert.deepEqual(sortArchiveCatalog(items, 'title', 'asc').map((item) => item.arcid), ['a', 'c', 'b']);
  assert.deepEqual(items.map((item) => item.arcid), ['b', 'a', 'c']);
});

test('archive catalog slices safely', () => {
  const items = [{ arcid: 'a' }, { arcid: 'b' }, { arcid: 'c' }];
  assert.deepEqual(sliceArchiveCatalog(items, 1, 1).map((item) => item.arcid), ['b']);
  assert.deepEqual(sliceArchiveCatalog(items, -5, 2).map((item) => item.arcid), ['a', 'b']);
});
