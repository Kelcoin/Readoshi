import test from 'node:test';
import assert from 'node:assert/strict';
import { computeContainedImageRect, rectsOverlap } from './pageIndicatorLayout.js';

test('detects even a one pixel partial overlap', () => {
  assert.equal(rectsOverlap({ left: 0, top: 0, right: 100, bottom: 100 }, { left: 99, top: 50, right: 120, bottom: 70 }, 0), true);
});
test('computes the rendered contain rectangle', () => {
  assert.deepEqual(computeContainedImageRect({ left: 0, top: 0, width: 100, height: 100 }, 200, 100), { left: 0, top: 25, right: 100, bottom: 75, width: 100, height: 50 });
});
