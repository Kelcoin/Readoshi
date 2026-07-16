import assert from 'node:assert/strict';
import test from 'node:test';

let scope = {};
try {
  scope = await import('../src/lib/configScope.js');
} catch {}

test('MD5 uses standard vectors for stable storage scopes', () => {
  assert.equal(typeof scope.md5, 'function', 'configScope.md5 must exist');
  assert.equal(scope.md5(''), 'd41d8cd98f00b204e9800998ecf8427e');
  assert.equal(scope.md5('abc'), '900150983cd24fb0d6963f7d28e17f72');
});

test('config scope binds normalized server and API key without plaintext', () => {
  assert.equal(typeof scope.createConfigScopeId, 'function', 'createConfigScopeId must exist');
  const first = scope.createConfigScopeId('HTTP://Example.COM:80/', '密钥');
  const same = scope.createConfigScopeId('http://example.com', '密钥');
  const otherKey = scope.createConfigScopeId('http://example.com', 'other');
  assert.match(first, /^[a-f0-9]{32}$/);
  assert.equal(first, same);
  assert.notEqual(first, otherKey);
  assert.equal(first.includes('Example'), false);
  assert.equal(first.includes('密钥'), false);
});

test('legacy storage is moved once into current scope', () => {
  assert.equal(typeof scope.scopedStorageKey, 'function');
  assert.equal(typeof scope.migrateLegacyStorageKey, 'function', 'migrateLegacyStorageKey must exist');
  const previousStorage = globalThis.localStorage;
  const values = new Map([
    ['lrr_server_url', 'http://one.example'],
    ['lrr_api_key', 'key-one'],
    ['lrr_history', '[{"id":"one"}]'],
  ]);
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  try {
    const scopedKey = scope.migrateLegacyStorageKey('lrr_history');
    assert.equal(values.get(scopedKey), '[{"id":"one"}]');
    assert.equal(values.has('lrr_history'), false);
    values.set('lrr_server_url', 'http://two.example');
    assert.equal(values.has(scope.scopedStorageKey('lrr_history')), false);
  } finally {
    globalThis.localStorage = previousStorage;
  }
});
