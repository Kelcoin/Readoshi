import assert from 'node:assert/strict';
import test from 'node:test';

let locks = {};
try {
  locks = await import('../src/lib/bodyScrollLock.js');
} catch {}

test('body scroll stays locked until every owner releases', () => {
  assert.equal(typeof locks.acquireBodyScrollLock, 'function', 'acquireBodyScrollLock must exist');
  const previousDocument = globalThis.document;
  globalThis.document = {
    body: { style: { overflow: 'auto' } },
    documentElement: { style: { overflow: 'clip' } },
  };
  try {
    const releaseDrawer = locks.acquireBodyScrollLock();
    const releaseDialog = locks.acquireBodyScrollLock();
    assert.equal(document.body.style.overflow, 'hidden');
    releaseDrawer();
    assert.equal(document.body.style.overflow, 'hidden');
    releaseDialog();
    assert.equal(document.body.style.overflow, 'auto');
    assert.equal(document.documentElement.style.overflow, 'clip');
    releaseDialog();
    assert.equal(document.body.style.overflow, 'auto');
  } finally {
    globalThis.document = previousDocument;
  }
});
