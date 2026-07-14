import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readMetadataPluginResult } from '../src/lib/metadataEditor.js';

const metadataPage = fs.readFileSync(new URL('../src/pages/MetadataPage.jsx', import.meta.url), 'utf8');
const pwaStatus = fs.readFileSync(new URL('../src/components/PwaStatus.jsx', import.meta.url), 'utf8');

assert.throws(
  () => readMetadataPluginResult({ operation: 'use_plugin', success: 0, error: '登录失败' }),
  /登录失败/,
);

assert.deepEqual(
  readMetadataPluginResult({ operation: 'use_plugin', success: 1, data: { new_tags: 'artist:test' } }),
  { tags: 'artist:test' },
);

assert.deepEqual(
  readMetadataPluginResult({ operation: 'use_plugin', success: 1, new_tags: 'group:legacy' }),
  { tags: 'group:legacy' },
);

assert.match(
  metadataPage,
  /showStatus\(tags \? '插件标签已合并，保存后生效。' : '插件执行完成，未返回新标签。',\s*tags \? 'success' : 'info',\s*\{ autoHide: true \}\)/,
  'plugin completion status must auto-hide',
);
assert.match(metadataPage, /catch \(error\) \{ showStatus\(error\.message, 'error'\); \}/);
assert.match(metadataPage, /data-open=\{status && !status\.closing \? 'true' : 'false'\}/);
assert.match(pwaStatus, /textAlign:\s*'center'/);
assert.match(pwaStatus, /padding:\s*'8px 14px'/);
