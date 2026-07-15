import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as apiModule from '../src/lib/api.js';

const { normalizeUntaggedArchiveIds, loadArchiveMetadataBatch } = apiModule;

const api = fs.readFileSync(new URL('../src/lib/api.js', import.meta.url), 'utf8');
const home = fs.readFileSync(new URL('../src/pages/Home.jsx', import.meta.url), 'utf8');

assert.deepEqual(normalizeUntaggedArchiveIds(['abc', 'def']), ['abc', 'def']);
assert.deepEqual(normalizeUntaggedArchiveIds({ data: ['abc'] }), ['abc']);
assert.deepEqual(normalizeUntaggedArchiveIds({ archives: [{ arcid: 'abc' }, { id: 'def' }] }), ['abc', 'def']);
assert.deepEqual(normalizeUntaggedArchiveIds(null), []);

assert.equal(typeof loadArchiveMetadataBatch, 'function', 'missing bounded archive metadata loader');

let active = 0;
let maxActive = 0;
const loaded = await loadArchiveMetadataBatch(['a', 'b', 'c', 'd'], async (id) => {
  active += 1;
  maxActive = Math.max(maxActive, active);
  await new Promise((resolve) => setTimeout(resolve, 2));
  active -= 1;
  return { arcid: id };
}, { concurrency: 2 });
assert.deepEqual(loaded.map((item) => item.arcid), ['a', 'b', 'c', 'd']);
assert.equal(maxActive, 2);

await assert.rejects(
  loadArchiveMetadataBatch(['ok', 'broken'], async (id) => {
    if (id === 'broken') throw new Error('metadata failed');
    return { arcid: id };
  }),
  /metadata failed/,
);

const missing400 = Object.assign(new Error('missing'), { status: 400 });
const missing404 = Object.assign(new Error('missing'), { status: 404 });
const kept = await loadArchiveMetadataBatch(['first', 'gone-400', 'second', 'gone-404'], async (id) => {
  if (id === 'gone-400') throw missing400;
  if (id === 'gone-404') throw missing404;
  return { arcid: id };
}, { concurrency: 2, ignoreMissing: true });
assert.deepEqual(kept.map((item) => item.arcid), ['first', 'second']);

const unauthorized = Object.assign(new Error('unauthorized'), { status: 401 });
await assert.rejects(
  loadArchiveMetadataBatch(['blocked'], async () => { throw unauthorized; }, { ignoreMissing: true }),
  (error) => error === unauthorized,
);

const abortError = new Error('cancelled');
abortError.name = 'AbortError';
await assert.rejects(
  loadArchiveMetadataBatch(['cancelled'], async () => { throw abortError; }),
  (error) => error === abortError,
);

assert.match(api, /getUntaggedArchives:\s*async\s*\(options\s*=\s*\{\}\)\s*=>\s*normalizeUntaggedArchiveIds\(await request\('\/archives\/untagged',\s*'GET',\s*null,\s*options\)\)/);
assert.match(home, /无标签/);
assert.match(home, /UNTAGGED_CATEGORY_ID/);
assert.match(home, /if \(ids\.length === 0\)/);
assert.match(home, /ids\.slice\(batchStart, batchStart \+ pageSize\)/);
assert.match(home, /ignoreMissing:\s*true/);
assert.match(home, /handleUntaggedCategoryClick[\s\S]*lastFetchedFilterRef\.current\s*=\s*''/);
assert.match(home, /handleUntaggedCategoryClick[\s\S]*lastFetchedRef\.current\s*=\s*0/);
assert.match(home, /archiveLoadError/);
