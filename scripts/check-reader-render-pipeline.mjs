import assert from 'node:assert/strict';

const {
  READER_STAGE_STATUS,
  createReaderRenderState,
  getReaderCapabilities,
  isRetryableReaderBootstrapError,
  loadReaderBootstrapResource,
  readerRenderReducer,
} = await import('../src/lib/readerRenderPipeline.js');

const cold = createReaderRenderState();
assert.deepEqual(cold, {
  metadata: { status: 'loading', error: null },
  manifest: { status: 'loading', error: null },
  selection: { status: 'loading', error: null },
});

const restored = createReaderRenderState({ hasMetadata: true, hasManifest: true, hasSelection: true });
assert.equal(restored.metadata.status, READER_STAGE_STATUS.READY);
assert.equal(restored.manifest.status, READER_STAGE_STATUS.READY);
assert.equal(restored.selection.status, READER_STAGE_STATUS.READY);

const metadataReady = readerRenderReducer(cold, { type: 'ready', resource: 'metadata' });
assert.equal(metadataReady.metadata.status, 'ready');
assert.equal(metadataReady.manifest.status, 'loading', 'resources must settle independently');
assert.equal(metadataReady.selection.status, 'loading', 'the first page must wait for progress selection');

const manifestError = new Error('manifest failed');
const failed = readerRenderReducer(metadataReady, { type: 'error', resource: 'manifest', error: manifestError });
assert.equal(failed.metadata.status, 'ready', 'one failed slot must not roll back a ready slot');
assert.equal(failed.manifest.status, 'error');
assert.equal(failed.manifest.error, manifestError);

const retried = readerRenderReducer(failed, { type: 'start', resource: 'manifest' });
assert.deepEqual(retried.manifest, { status: 'loading', error: null });

const reset = readerRenderReducer(retried, { type: 'reset', hasMetadata: false, hasManifest: false, hasSelection: false });
assert.deepEqual(reset, cold);

assert.deepEqual(getReaderCapabilities(cold, 0), {
  canShowMetadata: false,
  canShowPageCount: false,
  canNavigate: false,
  canRenderPage: false,
});
assert.deepEqual(getReaderCapabilities(restored, 12), {
  canShowMetadata: true,
  canShowPageCount: true,
  canNavigate: true,
  canRenderPage: true,
});
assert.equal(getReaderCapabilities(restored, 0).canRenderPage, false, 'empty manifests cannot render a page');

const manifestOnly = readerRenderReducer(cold, { type: 'ready', resource: 'manifest' });
assert.equal(getReaderCapabilities(manifestOnly, 12).canShowPageCount, true, 'page count may appear before selection');
assert.equal(getReaderCapabilities(manifestOnly, 12).canNavigate, false, 'navigation must wait for progress selection');
assert.equal(getReaderCapabilities(manifestOnly, 12).canRenderPage, false, 'current image must wait for progress selection');

assert.equal(isRetryableReaderBootstrapError(new TypeError('Failed to fetch')), true);
assert.equal(isRetryableReaderBootstrapError(Object.assign(new Error('busy'), { status: 503 })), true);
assert.equal(isRetryableReaderBootstrapError(Object.assign(new Error('missing'), { status: 404 })), false);
assert.equal(isRetryableReaderBootstrapError(Object.assign(new Error('cancelled'), { name: 'AbortError' })), false);

let transientAttempts = 0;
const retryWaits = [];
const recovered = await loadReaderBootstrapResource(
  async () => {
    transientAttempts += 1;
    if (transientAttempts < 3) throw new TypeError('Failed to fetch');
    return 'ready';
  },
  { wait: async (delay) => retryWaits.push(delay) },
);
assert.equal(recovered, 'ready');
assert.equal(transientAttempts, 3, 'transient bootstrap failures should receive two bounded retries');
assert.deepEqual(retryWaits, [180, 450]);

let missingAttempts = 0;
await assert.rejects(
  loadReaderBootstrapResource(async () => {
    missingAttempts += 1;
    throw Object.assign(new Error('missing'), { status: 404 });
  }, { wait: async () => {} }),
  /missing/,
);
assert.equal(missingAttempts, 1, 'permanent API errors must not be retried');

console.log('Reader render pipeline checks passed');
