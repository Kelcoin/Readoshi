import assert from 'node:assert/strict';
import test from 'node:test';

import { parseRouteSearch } from './navigation.js';

test('parses upload route', () => {
  assert.deepEqual(parseRouteSearch('?view=upload'), { kind: 'upload' });
});

test('keeps archive routes ahead of standalone views', () => {
  assert.deepEqual(parseRouteSearch('?view=upload&id=abc'), { kind: 'reader', archiveId: 'abc' });
});
