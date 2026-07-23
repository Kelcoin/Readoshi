import assert from 'node:assert/strict';
import test from 'node:test';
import { metadataTagReservedWidth } from '../src/lib/metadataTagLayout.js';
import { getTagSuggestPlacement } from '../src/lib/tagSuggestLayout.js';

test('unmeasured metadata tags never overwrite a known row width', () => {
  assert.equal(metadataTagReservedWidth(null, null, 57), null);
  assert.equal(metadataTagReservedWidth(120, 80, 57), 177);
  assert.equal(metadataTagReservedWidth(80, 120, 57), 177);
});

test('tag suggestions stay attached above or below the input without overlap', () => {
  const below = getTagSuggestPlacement(
    { left: 20, width: 300, top: 100, bottom: 140 },
    360,
    700,
  );
  assert.equal(below.top, 146);
  assert.equal('bottom' in below, false);
  assert.equal(below.maxHeight, 320);

  const above = getTagSuggestPlacement(
    { left: 20, width: 300, top: 500, bottom: 540 },
    360,
    600,
  );
  assert.equal(above.bottom, 106);
  assert.equal('top' in above, false);
  assert.equal(above.maxHeight, 320);
});

test('tag suggestion placement clamps width and available height to viewport', () => {
  const placement = getTagSuggestPlacement(
    { left: -20, width: 500, top: 90, bottom: 130 },
    320,
    180,
  );
  assert.equal(placement.left, 12);
  assert.equal(placement.width, 296);
  assert.equal(placement.maxHeight, 72);
  assert.equal(placement.bottom, 96);
});

test('tag suggestions use the visible viewport when mobile chrome or keyboard reduces space', () => {
  const placement = getTagSuggestPlacement(
    { left: 20, width: 300, top: 360, bottom: 404 },
    390,
    844,
    { viewportTop: 0, viewportBottom: 430 },
  );
  assert.equal(placement.bottom, 76);
  assert.equal('top' in placement, false);
  assert.equal(placement.maxHeight, 320);
});
