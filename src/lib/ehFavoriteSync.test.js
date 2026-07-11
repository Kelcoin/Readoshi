import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldSyncEhFavorite } from './ehFavoriteSync.js';

test('only syncs when global setting and this deletion are both enabled', () => {
  assert.equal(shouldSyncEhFavorite(true, true), true);
  assert.equal(shouldSyncEhFavorite(true, false), false);
  assert.equal(shouldSyncEhFavorite(false, true), false);
  assert.equal(shouldSyncEhFavorite(false, false), false);
});
