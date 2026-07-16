import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

const packageJson = JSON.parse(read('package.json'));
assert.equal(typeof packageJson.scripts?.test, 'string');
assert.equal(typeof packageJson.scripts?.lint, 'string');
assert.equal(typeof packageJson.scripts?.check, 'string');
assert.equal(fs.existsSync(new URL('../.eslintrc.cjs', import.meta.url)), true, 'ESLint config missing');
assert.equal(read('.gitignore').includes('scripts/check-*.mjs'), false, 'check scripts must be tracked');

const history = read('src/lib/history.js');
const watchlist = read('src/lib/watchlist.js');
const metadata = read('src/lib/archiveMetadataCache.js');
const imageCache = read('src/lib/imageCache.js');
assert.match(history, /migrateLegacyStorageKey\(HISTORY_PROGRESS_CACHE_KEY\)/, 'history progress must be scoped');
assert.match(watchlist, /migrateLegacyStorageKey\(hasRemoteWatchlist\(\)/, 'watchlist must be scoped');
assert.match(metadata, /scopedArchiveKey\(id\)/, 'metadata memory cache must be scoped');
assert.match(imageCache, /export async function deleteImageKeys/, 'targeted image invalidation missing');
assert.doesNotMatch(imageCache, /retiredObjectUrls/, 'evicted object URLs must not accumulate');

console.log('audit checks: PASS');
