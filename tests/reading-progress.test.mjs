import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mergeReadingProgress,
  mergeWatchlistReadingProgress,
  normalizeReadingProgress,
} from '../src/lib/readingProgress.js';
import {
  mergeLatestHistoryItems,
  mergeMonotonicHistoryItems,
} from '../src/lib/historyProgressCache.js';

test('newer progress may move backwards when regression is enabled', () => {
  assert.deepEqual(
    mergeReadingProgress(
      { page: 30, total: 40, time: 100 },
      { page: 1, total: 40, time: 200 },
      { allowRegression: true },
    ),
    { page: 1, total: 40, time: 200 },
  );
});

test('forward-only progress keeps the highest page while accepting fresh metadata', () => {
  assert.deepEqual(
    mergeReadingProgress(
      { page: 30, total: 40, time: 100 },
      { page: 1, total: 45, time: 200 },
      { allowRegression: false },
    ),
    { page: 30, total: 45, time: 200 },
  );
});

test('explicit clear is authoritative even when an old high page exists', () => {
  assert.deepEqual(
    mergeReadingProgress(
      { page: 30, total: 40, time: 300 },
      { page: 0, total: 40, time: 200, cleared: true },
      { allowRegression: false },
    ),
    { page: 0, total: 40, time: 200, cleared: true },
  );
});

test('latest history merge uses timestamp instead of maximum page', () => {
  assert.deepEqual(mergeLatestHistoryItems(
    [{ id: 'a', page: 30, time: 100 }],
    [{ id: 'a', page: 1, time: 200 }],
  ), [{ id: 'a', page: 1, time: 200 }]);
});

test('forward-only history merge keeps the highest persisted page', () => {
  assert.deepEqual(mergeMonotonicHistoryItems(
    [{ id: 'a', page: 30, time: 100 }],
    [{ id: 'a', page: 1, time: 200 }],
  ), [{ id: 'a', page: 30, time: 200 }]);
});

test('watchlist uses the canonical history page instead of a stale card maximum', () => {
  const result = mergeWatchlistReadingProgress(
    [{ id: 'a', page: 30, total: 40 }],
    [{ id: 'a', page: 1, total: 40, time: 200 }],
  );
  assert.equal(result[0].page, 1);
});

test('normalization preserves page zero for clear events', () => {
  assert.deepEqual(normalizeReadingProgress({ page: 0, total: 33, time: 10, cleared: true }), {
    page: 0,
    total: 33,
    time: 10,
    cleared: true,
  });
});
