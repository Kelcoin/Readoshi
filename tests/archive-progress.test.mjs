import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearArchiveProgressMarker,
  clearArchiveReadingProgress,
  hasArchiveReadingProgress,
  hasArchiveProgressMarker,
  markArchiveProgressCleared,
  shouldPersistArchiveReadingProgress,
} from '../src/lib/archiveProgress.js';

test('clear progress uses force page zero and removes local history after server success', async () => {
  const calls = [];
  const local = [];
  const result = await clearArchiveReadingProgress({ arcid: 'archive', progress: 9 }, {
    api: {
      getServerInfo: async () => ({ server_tracks_progress: true }),
      updateProgress: async (...args) => calls.push(args),
    },
    removeHistory: async (id) => local.push(['remove', id]),
    saveHistoryEntry: async () => local.push(['save']),
  });
  assert.deepEqual(calls, [['archive', 0, { force: true }]]);
  assert.deepEqual(local, [['remove', 'archive']]);
  assert.deepEqual(result, { page: 0, fallback: false });
});

test('clear progress falls back to page one and updates local history only after fallback succeeds', async () => {
  const calls = [];
  const local = [];
  const archive = { id: 'archive', title: 'Test', progress: 5 };
  const result = await clearArchiveReadingProgress(archive, {
    api: {
      getServerInfo: async () => ({ server_tracks_progress: true }),
      updateProgress: async (id, page, options) => {
        calls.push([id, page, options]);
        if (page === 0) throw new Error('force unsupported');
      },
    },
    removeHistory: async () => local.push(['remove']),
    saveHistoryEntry: async (entry, page) => local.push(['save', entry.arcid, page]),
  });
  assert.deepEqual(calls, [['archive', 0, { force: true }], ['archive', 1, undefined]]);
  assert.deepEqual(local, [['save', 'archive', 1]]);
  assert.deepEqual(result, { page: 1, fallback: true });
});

test('clear progress keeps local state when both server updates fail', async () => {
  let localMutations = 0;
  await assert.rejects(clearArchiveReadingProgress({ arcid: 'archive', progress: 2 }, {
    api: {
      getServerInfo: async () => ({ server_tracks_progress: true }),
      updateProgress: async () => { throw new Error('offline'); },
    },
    removeHistory: async () => { localMutations += 1; },
    saveHistoryEntry: async () => { localMutations += 1; },
  }), /offline/);
  assert.equal(localMutations, 0);
});

test('progress action appears for either server or local progress', () => {
  assert.equal(hasArchiveReadingProgress(null, 0), false);
  assert.equal(hasArchiveReadingProgress({ progress: 0 }, 0), false);
  assert.equal(hasArchiveReadingProgress({ progress: 3 }, 0), true);
  assert.equal(hasArchiveReadingProgress({ progress: 0 }, 2), true);
});

test('cleared progress marker survives navigation until the reader advances past page one', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  markArchiveProgressCleared('archive', storage, 'test-key');
  assert.equal(hasArchiveProgressMarker('archive', storage, 'test-key'), true);
  assert.equal(shouldPersistArchiveReadingProgress(true, 1), false);
  assert.equal(shouldPersistArchiveReadingProgress(true, 2), true);
  clearArchiveProgressMarker('archive', storage, 'test-key');
  assert.equal(hasArchiveProgressMarker('archive', storage, 'test-key'), false);
});
