import assert from 'node:assert/strict';
import test from 'node:test';

import {
  dedupeUploadFiles,
  matchDownloadPlugin,
  normalizeDownloadPlugins,
  parseUploadUrls,
  runUploadTasks,
} from './upload.js';

test('parses, validates and deduplicates URL lines', () => {
  assert.deepEqual(parseUploadUrls('https://a.test/g/1\nftp://bad\nhttps://a.test/g/1'), {
    valid: ['https://a.test/g/1'],
    invalid: ['ftp://bad'],
  });
});

test('normalizes downloader regex and selects first matching plugin', () => {
  const result = normalizeDownloadPlugins({ plugins: [
    { name: 'First', namespace: 'first', oneshot_arg: 'https?://a\\.test/.*' },
    { name: 'Second', namespace: 'second', regex: 'https?://a\\.test/g/.*' },
  ] });

  assert.equal(matchDownloadPlugin('https://a.test/g/1', result.plugins)?.value, 'first');
  assert.deepEqual(result.options[0], { label: '自动匹配', value: 'auto' });
});

test('isolates invalid regex and leaves unmatched URL unresolved', () => {
  const result = normalizeDownloadPlugins([{ name: 'Broken', namespace: 'bad', oneshot_arg: '[' }]);

  assert.equal(result.warnings.length, 1);
  assert.equal(matchDownloadPlugin('https://a.test/g/1', result.plugins), null);
});

test('deduplicates files by name, size and lastModified', () => {
  const files = [
    { name: 'a.zip', size: 10, lastModified: 1 },
    { name: 'a.zip', size: 10, lastModified: 1 },
    { name: 'a.zip', size: 11, lastModified: 1 },
  ];

  assert.equal(dedupeUploadFiles(files).length, 2);
});

test('sequential tasks continue after an item fails', async () => {
  const seen = [];
  const results = await runUploadTasks(['a', 'b'], async (item) => {
    seen.push(item);
    if (item === 'a') throw new Error('failed');
    return 'ok';
  });

  assert.deepEqual(seen, ['a', 'b']);
  assert.deepEqual(results.map(item => item.status), ['failed', 'success']);
});
