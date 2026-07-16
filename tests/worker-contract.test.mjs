import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const worker = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const client = fs.readFileSync(new URL('../src/lib/worker-kv.js', import.meta.url), 'utf8');

test('Worker accepts sync tokens from headers only', () => {
  assert.doesNotMatch(worker, /searchParams\.get\(['"]token['"]\)/);
});

test('EH proxy validates exact HTTPS hosts and every redirect', () => {
  assert.match(worker, /const EH_HOSTS = new Set/);
  assert.match(worker, /url\.protocol !== 'https:'/);
  assert.match(worker, /url\.port && url\.port !== '443'/);
  assert.match(worker, /redirect: 'manual'/);
  assert.match(worker, /Blocked EH redirect/);
  assert.doesNotMatch(worker, /\(exhentai\\\.org\|e-hentai\\\.org\)\$/);
});

test('dedupe state requires server MD5 scope on Worker and client', () => {
  assert.match(worker, /x-lrr-server-scope/);
  assert.match(worker, /\^\[a-f0-9\]\{32\}\$/);
  assert.match(worker, /DEDUPE_KEY_PREFIX.*getToken\(request\).*scope/s);
  assert.match(client, /'x-lrr-server-scope': serverScope/);
});

test('sync mutations serialize and retain timestamp tombstones', () => {
  assert.match(worker, /withMutationLock/);
  assert.match(worker, /compactWatchlistState/);
  assert.match(worker, /deleted: normalizeDeletedItems/);
  assert.doesNotMatch(worker, /\.slice\(0, 200\)/);
});

test('Worker update checks are channel-scoped, cached, and non-blocking', () => {
  assert.match(worker, /const WORKER_RELEASE\s*=\s*\d+/);
  assert.match(worker, /WORKER_UPDATE_BRANCH/);
  assert.match(worker, /\['main', 'dev'\]/);
  assert.match(worker, /raw\.githubusercontent\.com/);
  assert.match(worker, /max-age=21600/);
});
