import test from 'node:test';
import assert from 'node:assert/strict';
import { findContentBounds } from './readerImageTransform.js';
test('finds white border around dark content', () => {
  const data = new Uint8ClampedArray(4 * 4 * 4).fill(255); const pixel = (1 * 4 + 1) * 4; data[pixel] = data[pixel + 1] = data[pixel + 2] = 0;
  assert.deepEqual(findContentBounds(data, 4, 4), { top: .25, right: .5, bottom: .5, left: .25 });
});
