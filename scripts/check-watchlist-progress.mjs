import assert from 'node:assert/strict';
import fs from 'node:fs';

const watchlistSource = fs.readFileSync(new URL('../src/lib/watchlist.js', import.meta.url), 'utf8');
const testableSource = watchlistSource.replace(/^import .*;\r?\n/gm, '');
const watchlistModule = await import(`data:text/javascript;base64,${Buffer.from(testableSource).toString('base64')}`);
const { getWatchlistAutoRemoveIds, mergeWatchlistProgress } = watchlistModule;

const merged = mergeWatchlistProgress(
  [
    { id: 'a', pagecount: 100, page: 12 },
    { id: 'b', total: 100 },
    { id: 'c' },
  ],
  [
    { id: 'a', page: 81, total: 100 },
    { id: 'b', page: 80, total: 100 },
    { id: 'c', page: 99 },
  ],
);

assert.equal(merged[0].page, 81, 'history must raise watchlist progress');
assert.equal(merged[1].page, 80, '80 percent progress must remain visible');
assert.deepEqual(
  getWatchlistAutoRemoveIds(merged),
  ['a'],
  'only progress strictly above 80 percent may auto-remove',
);
assert.deepEqual(
  getWatchlistAutoRemoveIds([{ id: 'unknown-total', page: 99 }]),
  [],
  'unknown totals must never auto-remove',
);

const homeSource = fs.readFileSync(new URL('../src/pages/Home.jsx', import.meta.url), 'utf8');
const watchlistPageSource = fs.readFileSync(new URL('../src/pages/WatchlistPage.jsx', import.meta.url), 'utf8');
const readerSource = fs.readFileSync(new URL('../src/pages/Reader.jsx', import.meta.url), 'utf8');

assert.match(homeSource, /mergeWatchlistProgress/);
assert.match(homeSource, /getWatchlistAutoRemoveIds/);
assert.match(homeSource, /currentPage=\{item\.page\}/);
assert.match(watchlistPageSource, /lrr:history-changed/);
assert.match(watchlistPageSource, /mergeWatchlistProgress/);
assert.match(watchlistPageSource, /getWatchlistAutoRemoveIds/);
assert.match(watchlistPageSource, /currentPage=\{item\.page\}/);
assert.match(readerSource, /highestPage\s*\/\s*totalPages\s*>\s*0\.8/);

console.log('watchlist progress checks passed');
