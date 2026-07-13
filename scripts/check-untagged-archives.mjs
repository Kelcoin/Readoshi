import fs from 'node:fs';
import assert from 'node:assert/strict';
import { normalizeUntaggedArchiveIds } from '../src/lib/api.js';

const api = fs.readFileSync(new URL('../src/lib/api.js', import.meta.url), 'utf8');
const home = fs.readFileSync(new URL('../src/pages/Home.jsx', import.meta.url), 'utf8');

assert.deepEqual(normalizeUntaggedArchiveIds(['abc', 'def']), ['abc', 'def']);
assert.deepEqual(normalizeUntaggedArchiveIds({ data: ['abc'] }), ['abc']);
assert.deepEqual(normalizeUntaggedArchiveIds({ archives: [{ arcid: 'abc' }, { id: 'def' }] }), ['abc', 'def']);
assert.deepEqual(normalizeUntaggedArchiveIds(null), []);

assert.match(api, /getUntaggedArchives:\s*async\s*\(\)\s*=>\s*normalizeUntaggedArchiveIds\(await request\('\/archives\/untagged'\)\)/);
assert.match(home, /无标签/);
assert.match(home, /UNTAGGED_CATEGORY_ID/);
assert.match(home, /if \(ids\.length === 0\)/);
