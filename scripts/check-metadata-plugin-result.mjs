import assert from 'node:assert/strict';
import { readMetadataPluginResult } from '../src/lib/metadataEditor.js';

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
