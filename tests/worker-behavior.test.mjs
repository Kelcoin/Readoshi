import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const workerSource = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const workerRelease = Number(workerSource.match(/const WORKER_RELEASE\s*=\s*(\d+)/)?.[1]);

function createWorker(entries = [], globals = {}) {
  const values = new Map([['tokens', JSON.stringify(['test-token'])], ...entries]);
  let listener = null;
  const context = {
    URL,
    URLSearchParams,
    Request,
    Response,
    Headers,
    Date,
    JSON,
    Math,
    Map,
    Set,
    Promise,
    console,
    setTimeout,
    clearTimeout,
    APP_VERSION: 'test',
    HISTORY_KV: {
      async get(key) { return values.get(key) ?? null; },
      async put(key, value) { values.set(key, String(value)); },
      async delete(key) { values.delete(key); },
      async list({ prefix = '' } = {}) {
        return { keys: Array.from(values.keys()).filter((key) => key.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
      },
    },
    addEventListener(type, callback) { if (type === 'fetch') listener = callback; },
    ...globals,
  };
  vm.runInNewContext(workerSource, context);
  return async function dispatch(path, { method = 'GET', scope, body } = {}) {
    const headers = { 'x-sync-token': 'test-token' };
    if (scope) headers['x-lrr-server-scope'] = scope;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const request = new Request(`https://worker.example${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let responsePromise;
    listener({ request, respondWith(value) { responsePromise = value; } });
    return responsePromise;
  };
}

const SCOPE_A = 'a'.repeat(32);
const SCOPE_B = 'b'.repeat(32);

test('Worker history is isolated by server scope and serializes concurrent writes', async () => {
  const dispatch = createWorker();
  const now = Date.now();
  const writes = [
    dispatch('/history', { method: 'PUT', scope: SCOPE_A, body: { history: { id: 'one', page: 1, time: now } } }),
    dispatch('/history', { method: 'PUT', scope: SCOPE_A, body: { history: { id: 'two', page: 2, time: now + 1 } } }),
  ];
  assert.deepEqual((await Promise.all(writes)).map((response) => response.status), [200, 200]);
  const sameScope = await (await dispatch('/history', { scope: SCOPE_A })).json();
  const otherScope = await (await dispatch('/history', { scope: SCOPE_B })).json();
  assert.deepEqual(sameScope.histories.map((item) => item.id).sort(), ['one', 'two']);
  assert.deepEqual(otherScope.histories, []);
});

test('Worker watchlist tombstone blocks an older client from reviving a deletion', async () => {
  const dispatch = createWorker();
  await dispatch('/watchlist', { method: 'PUT', scope: SCOPE_A, body: { item: { id: 'one', addedAt: 1000 } } });
  await dispatch('/watchlist', { method: 'DELETE', scope: SCOPE_A, body: { ids: ['one'] } });
  await dispatch('/watchlist', { method: 'PUT', scope: SCOPE_A, body: { item: { id: 'one', addedAt: 1000 } } });
  const state = await (await dispatch('/watchlist', { scope: SCOPE_A })).json();
  assert.deepEqual(state.items, []);
  assert.equal(state.deleted[0].id, 'one');
});

test('Worker claims legacy aggregate data into the first server scope once', async () => {
  const now = Date.now();
  const dispatch = createWorker([
    ['history:test-token', JSON.stringify({ histories: [{ id: 'legacy', page: 3, time: now }], deleted: [] })],
  ]);
  const migrated = await (await dispatch('/history', { scope: SCOPE_A })).json();
  const isolated = await (await dispatch('/history', { scope: SCOPE_B })).json();
  assert.equal(migrated.histories[0].id, 'legacy');
  assert.deepEqual(isolated.histories, []);
});

test('Worker status checks main by default and reports a newer release', async () => {
  let requestedUrl = '';
  const dispatch = createWorker([], {
    fetch: async (url) => {
      requestedUrl = String(url);
      return new Response(`const WORKER_RELEASE = ${workerRelease + 1};`, { status: 200 });
    },
  });
  const html = await (await dispatch('/')).text();
  assert.match(requestedUrl, /\/main\/worker\.js$/);
  assert.match(html, /发现 Worker 更新/);
  assert.match(html, new RegExp(`本地 ${workerRelease} · 远端 ${workerRelease + 1}`));
});

test('Worker status accepts dev and falls back invalid branches to main', async () => {
  const urls = [];
  const remote = async (url) => {
    urls.push(String(url));
    return new Response(`const WORKER_RELEASE = ${workerRelease};`, { status: 200 });
  };
  const devHtml = await (await createWorker([], { fetch: remote, WORKER_UPDATE_BRANCH: 'dev' })('/')).text();
  const fallbackHtml = await (await createWorker([], { fetch: remote, WORKER_UPDATE_BRANCH: 'feature' })('/')).text();
  assert.match(urls[0], /\/dev\/worker\.js$/);
  assert.match(urls[1], /\/main\/worker\.js$/);
  assert.match(devHtml, /dev 最新版本/);
  assert.match(fallbackHtml, /main 最新版本/);
});

test('Worker update check falls back to GitHub API when Raw is unavailable', async () => {
  const urls = [];
  const dispatch = createWorker([], {
    fetch: async (url) => {
      urls.push(String(url));
      if (String(url).includes('raw.githubusercontent.com')) throw new Error('raw unavailable');
      return new Response(`const WORKER_RELEASE = ${workerRelease + 1};`, { status: 200 });
    },
  });
  const html = await (await dispatch('/')).text();
  assert.match(urls[0], /raw\.githubusercontent\.com/);
  assert.match(urls[1], /api\.github\.com\/repos\/Kelcoin\/Readoshi\/contents\/worker\.js\?ref=main/);
  assert.match(html, /发现 Worker 更新/);
});

test('Worker update failure degrades without breaking status page', async () => {
  const dispatch = createWorker([], { fetch: async () => { throw new Error('offline'); } });
  const response = await dispatch('/');
  assert.equal(response.status, 200);
  assert.match(await response.text(), /更新检查暂时不可用/);
});
