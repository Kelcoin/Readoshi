import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeTags, parseTags } from './metadataEditor.js';
test('tag input trims and de-duplicates case-insensitively', () => assert.deepEqual(parseTags('artist:a, Artist:A, female:x'), ['artist:a', 'female:x']));
test('plugin tags merge without replacing current tags', () => assert.deepEqual(mergeTags(['artist:a'], 'female:x,artist:a'), ['artist:a', 'female:x']));
