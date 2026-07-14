import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  mergeCachedHistoryProgress,
  mergeHistoryProgressCache,
  mergeMonotonicHistoryItems,
} from '../src/lib/historyProgressCache.js';

assert.deepEqual(
  mergeMonotonicHistoryItems(
    [{ id: 'a', page: 80, time: 100 }],
    [{ id: 'a', page: 20, time: 200 }, { id: 'b', page: 3, time: 150 }],
  ),
  [{ id: 'a', page: 80, time: 200 }, { id: 'b', page: 3, time: 150 }],
);

const mergedCache = mergeHistoryProgressCache(
  { a: { page: 80, total: 100, time: 100 } },
  [{ id: 'a', page: 20, total: 90, time: 200 }],
);
assert.deepEqual(mergedCache.a, { page: 80, total: 100, time: 200 });

assert.deepEqual(
  mergeCachedHistoryProgress(
    [{ id: 'a', page: 20, total: 90, time: 200 }],
    { a: { page: 80, total: 100, time: 100 } },
  )[0],
  { id: 'a', page: 80, total: 100, time: 200 },
);

const historySource = fs.readFileSync(new URL('../src/lib/history.js', import.meta.url), 'utf8');
const readerSource = fs.readFileSync(new URL('../src/pages/Reader.jsx', import.meta.url), 'utf8');

assert.match(historySource, /const HISTORY_SYNC_INTERVAL_MS = 8 \* 1000/);
assert.match(historySource, /function scheduleHistoryFlush[\s\S]*if \(historyFlushTimer\) return/);
assert.match(historySource, /await flushHistorySync\(\);[\s\S]*workerJson\('\/history'\)/);
assert.match(historySource, /mergeMonotonicHistoryItems\(remoteHistories, getStoredHistory\(\)\)/);
assert.doesNotMatch(historySource, /deferUntilExit/);

export { historySource, readerSource };
