import assert from 'node:assert/strict';
import test from 'node:test';

import * as api from '../src/lib/api.js';
import * as upload from '../src/lib/upload.js';
import * as workerConfig from '../src/lib/worker-config.js';

let readerSettings = {};
try {
  readerSettings = await import('../src/lib/readerSettings.js');
} catch {}

test('API keys are Base64 encoded from UTF-8 bytes', () => {
  assert.equal(typeof api.encodeApiKey, 'function', 'encodeApiKey must exist');
  assert.equal(api.encodeApiKey('密钥'), Buffer.from('密钥', 'utf8').toString('base64'));
});

test('reader settings reject unsafe automatic turn intervals', () => {
  assert.equal(typeof readerSettings.normalizeReaderSettings, 'function', 'normalizeReaderSettings must load in Node');
  assert.equal(readerSettings.normalizeReaderSettings({ autoTurnInterval: 0 }).autoTurnInterval, 5);
  assert.equal(readerSettings.normalizeReaderSettings({ autoTurnInterval: -8 }).autoTurnInterval, 5);
  assert.equal(readerSettings.normalizeReaderSettings({ autoTurnInterval: 9999 }).autoTurnInterval, 3600);
  assert.equal(readerSettings.normalizeReaderSettings({ autoTurnInterval: 12 }).autoTurnInterval, 12);
  assert.equal(readerSettings.normalizeReaderSettings({}).allowProgressRegression, true);
  assert.equal(readerSettings.normalizeReaderSettings({ allowProgressRegression: false }).allowProgressRegression, false);
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
