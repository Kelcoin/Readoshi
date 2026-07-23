import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import * as api from '../src/lib/api.js';
import * as upload from '../src/lib/upload.js';
import * as workerConfig from '../src/lib/worker-config.js';

const read = (path) => readFileSync(path, 'utf8');

let readerSettings = {};
try {
  readerSettings = await import('../src/lib/readerSettings.js');
} catch {}

test('API keys are Base64 encoded from UTF-8 bytes', () => {
  assert.equal(typeof api.encodeApiKey, 'function', 'encodeApiKey must exist');
  assert.equal(api.encodeApiKey('密钥'), Buffer.from('密钥', 'utf8').toString('base64'));
});

test('archive search responses are reused briefly and can be cleared', async () => {
  assert.equal(typeof api.clearArchiveSearchResponseCache, 'function');
  const previousStorage = globalThis.localStorage;
  const previousFetch = globalThis.fetch;
  const previousNow = Date.now;
  let now = 1000;
  let calls = 0;
  globalThis.localStorage = {
    getItem: (key) => (key === 'lrr_server_url' ? 'https://example.test' : ''),
  };
  globalThis.fetch = async () => {
    calls += 1;
    return {
      ok: true,
      text: async () => JSON.stringify({ data: [{ arcid: String(calls) }] }),
    };
  };
  Date.now = () => now;
  try {
    api.clearArchiveSearchResponseCache();
    const first = await api.lrrApi.search('artist:test$', 0, 'date_added', 'desc');
    const second = await api.lrrApi.search(' artist:test$ ', 0, 'date_added', 'desc');
    assert.equal(calls, 1);
    assert.deepEqual(second, first);

    now += 60_001;
    await api.lrrApi.search('artist:test$', 0, 'date_added', 'desc');
    assert.equal(calls, 2);

    api.clearArchiveSearchResponseCache();
    await api.lrrApi.search('artist:test$', 0, 'date_added', 'desc');
    assert.equal(calls, 3);
  } finally {
    api.clearArchiveSearchResponseCache?.();
    Date.now = previousNow;
    globalThis.fetch = previousFetch;
    globalThis.localStorage = previousStorage;
  }
});

test('archive search cache evicts the least recently used response', async () => {
  const previousStorage = globalThis.localStorage;
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.localStorage = {
    getItem: (key) => (key === 'lrr_server_url' ? 'https://example.test' : ''),
  };
  globalThis.fetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({ data: [{ call: ++calls }] }),
  });
  try {
    api.clearArchiveSearchResponseCache();
    await api.lrrApi.search('q0');
    await api.lrrApi.search('q1');
    await api.lrrApi.search('q0');
    for (let index = 2; index <= 30; index += 1) {
      await api.lrrApi.search(`q${index}`);
    }
    assert.equal(calls, 31);
    await api.lrrApi.search('q0');
    assert.equal(calls, 31);
    await api.lrrApi.search('q1');
    assert.equal(calls, 32);
  } finally {
    api.clearArchiveSearchResponseCache();
    globalThis.fetch = previousFetch;
    globalThis.localStorage = previousStorage;
  }
});

test('reader settings reject unsafe automatic turn intervals', () => {
  assert.equal(typeof readerSettings.normalizeReaderSettings, 'function', 'normalizeReaderSettings must load in Node');
  assert.equal(readerSettings.normalizeReaderSettings({ autoTurnInterval: 0 }).autoTurnInterval, 5);
  assert.equal(readerSettings.normalizeReaderSettings({ autoTurnInterval: -8 }).autoTurnInterval, 5);
  assert.equal(readerSettings.normalizeReaderSettings({ autoTurnInterval: 9999 }).autoTurnInterval, 3600);
  assert.equal(readerSettings.normalizeReaderSettings({ autoTurnInterval: 12 }).autoTurnInterval, 12);
  assert.equal(readerSettings.normalizeReaderSettings({}).allowProgressRegression, true);
  assert.equal(readerSettings.normalizeReaderSettings({ allowProgressRegression: false }).allowProgressRegression, false);
  assert.equal(readerSettings.normalizeReaderSettings({}).maxConcurrentDecodes, 3);
  assert.equal(readerSettings.normalizeReaderSettings({ maxConcurrentDecodes: 0 }).maxConcurrentDecodes, 1);
  assert.equal(readerSettings.normalizeReaderSettings({ maxConcurrentDecodes: 7 }).maxConcurrentDecodes, 6);
  assert.equal(readerSettings.normalizeReaderSettings({ maxConcurrentDecodes: 4.9 }).maxConcurrentDecodes, 4);
});

test('reader settings keep E-Hentai sorting valid across Home and Reader', () => {
  const defaults = readerSettings.normalizeReaderSettings({});
  assert.equal(defaults.ehMinScore, 0);
  assert.equal(defaults.ehMaxComments, 45);
  assert.equal(defaults.ehSortMethod, 'score');
  assert.equal(readerSettings.normalizeReaderSettings({ ehSortMethod: 'posted' }).ehSortMethod, 'time');
  assert.equal(readerSettings.normalizeReaderSettings({ ehSortMethod: 'invalid' }).ehSortMethod, 'score');

  const home = read('src/pages/Home.jsx');
  assert.match(home, /normalizeReaderSettings\(\{[\s\S]*ehCookie:/);
  assert.doesNotMatch(home, /const DEFAULT_READER_EH_SETTINGS\s*=/);
});

test('drag and drop keeps only supported archive files', () => {
  assert.equal(typeof upload.partitionUploadFiles, 'function', 'partitionUploadFiles must exist');
  const files = [
    { name: 'book.cbz', size: 1, lastModified: 1 },
    { name: 'scan.PDF', size: 2, lastModified: 2 },
    { name: 'notes.txt', size: 3, lastModified: 3 },
  ];
  const result = upload.partitionUploadFiles(files);
  assert.deepEqual(result.accepted.map((file) => file.name), ['book.cbz', 'scan.PDF']);
  assert.deepEqual(result.rejected.map((file) => file.name), ['notes.txt']);
});

test('config import ignores non-string field values', () => {
  const previousStorage = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  try {
    const payload = { lrr_server_url: { unsafe: true }, lrr_api_key: 'ok' };
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    assert.equal(workerConfig.importConfig(btoa(binary)), 1);
    assert.equal(values.has('lrr_server_url'), false);
    assert.equal(values.get('lrr_api_key'), 'ok');
  } finally {
    globalThis.localStorage = previousStorage;
  }
});
