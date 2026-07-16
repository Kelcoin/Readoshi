import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const worker = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const client = fs.readFileSync(new URL('../src/lib/worker-kv.js', import.meta.url), 'utf8');
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

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

test('Worker has no remote update checker and fallback matches package version', () => {
  const appRelease = worker.match(/const APP_RELEASE\s*=\s*['"]([^'"]+)['"]/);
  assert.equal(appRelease?.[1], pkg.version);
  assert.match(worker, /const FALLBACK_APP_VERSION\s*=\s*`v\$\{APP_RELEASE\}`/);
  assert.doesNotMatch(worker, /WORKER_RELEASE|WORKER_UPDATE_BRANCH|checkWorkerUpdate|getWorkerSourceUrl|raw\.githubusercontent\.com\/Kelcoin\/Readoshi\/.+\/worker\.js/);
});
