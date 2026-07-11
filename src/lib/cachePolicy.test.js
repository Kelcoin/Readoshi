import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCacheLimit, selectCacheEvictions } from './cachePolicy.js';

test('automatic cache limit is twenty percent and clamped', () => {
  assert.equal(resolveCacheLimit('auto', 5 * 1024 ** 3), 1024 ** 3);
  assert.equal(resolveCacheLimit('auto', 100 * 1024 ** 2), 256 * 1024 ** 2);
});
test('eviction is LRU and protects active keys', () => {
  const entries = [{ key: 'a', size: 50, lastAccessedAt: 1 }, { key: 'b', size: 50, lastAccessedAt: 2 }];
  assert.deepEqual(selectCacheEvictions(entries, 100, new Set(['a'])).map(x => x.key), ['b']);
});
