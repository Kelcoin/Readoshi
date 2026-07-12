import assert from 'node:assert/strict';
import test from 'node:test';

import { lrrApi } from './api.js';

async function captureRequest(action) {
  const originalFetch = globalThis.fetch;
  const originalStorage = globalThis.localStorage;
  let captured;
  globalThis.localStorage = {
    getItem(key) {
      if (key === 'lrr_server_url') return 'https://reader.test';
      if (key === 'lrr_api_key') return 'secret';
      return null;
    },
  };
  globalThis.fetch = async (url, options = {}) => {
    captured = { url: String(url), options };
    return new Response(JSON.stringify({ success: 1 }), { status: 200 });
  };
  try {
    await action();
    return captured;
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.localStorage = originalStorage;
  }
}

test('uploads archive as PUT multipart without overriding content type', async () => {
  const file = new Blob(['archive']);
  Object.defineProperty(file, 'name', { value: 'sample.zip' });
  const request = await captureRequest(() => lrrApi.uploadArchive(file));

  assert.equal(request.url, 'https://reader.test/api/archives/upload');
  assert.equal(request.options.method, 'PUT');
  assert.ok(request.options.body instanceof FormData);
  assert.equal(request.options.headers['Content-Type'], undefined);
  assert.match(request.options.headers.Authorization, /^Bearer /);
});

test('uses downloader plugin with URL argument', async () => {
  const request = await captureRequest(() => lrrApi.useDownloadPlugin('eh', 'https://e-hentai.org/g/1/a'));

  assert.equal(request.options.method, 'POST');
  assert.match(request.url, /plugin=eh/);
  assert.match(request.url, /arg=https%3A%2F%2Fe-hentai\.org%2Fg%2F1%2Fa/);
});
