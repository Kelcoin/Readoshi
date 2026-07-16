import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const workerSource = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');

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

test('Worker status performs no remote update request', async () => {
  let fetchCalls = 0;
  const dispatch = createWorker([], { fetch: async () => { fetchCalls += 1; throw new Error('unexpected fetch'); } });
  const html = await (await dispatch('/')).text();
  assert.equal(fetchCalls, 0);
  assert.doesNotMatch(html, /Worker 更新|最新版本|更新检查/);
});

test('Worker status uses Readoshi branding and animated centered KV panels', async () => {
  const html = await (await createWorker()('/')).text();
  assert.match(html, /<title>Readoshi Sync Worker<\/title>/);
  assert.match(html, /class="brand-logo"[^>]+public\/logo-white\.png/);
  assert.match(html, /<h1>Readoshi Sync Worker<\/h1>/);
  assert.match(html, /请输入合法 Token，仅能导入 \/ 导出该 Token 对应的阅读历史与非重复记录。/);
  assert.match(html, /\.collapsible\s*\{[^}]*grid-template-rows:\s*0fr[^}]*transition:/s);
  assert.match(html, /\.collapsible\.is-open\s*\{[^}]*grid-template-rows:\s*1fr/s);
  assert.match(html, /\.tool-actions\s*\{[^}]*justify-content:\s*center/s);
  assert.match(html, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.match(html, /class="collapsible is-open"/);
  assert.match(html, /classList\.toggle\('is-open'/);
});
