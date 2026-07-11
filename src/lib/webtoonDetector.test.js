import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyWebtoonSeams, compareSeamPixels, isNearWhite } from './webtoonDetector.js';

test('white seams are excluded from webtoon evidence', () => assert.equal(isNearWhite({ l: .98, chroma: .01 }), true));
test('requires a majority of valid continuous seams', () => {
  const seams = Array.from({ length: 4 }, (_, i) => ({ validRatio: .5, white: false, medianDelta: i < 3 ? .02 : .2, p75Delta: i < 3 ? .04 : .2 }));
  assert.equal(classifyWebtoonSeams(seams).isWebtoon, true);
});
test('pixel seam comparison ignores white pixels', () => {
  const result = compareSeamPixels(new Uint8ClampedArray([255,255,255,255, 10,20,30,255]), new Uint8ClampedArray([255,255,255,255, 11,21,31,255]));
  assert.equal(result.validRatio, .5); assert.ok(result.medianDelta < .01);
});
