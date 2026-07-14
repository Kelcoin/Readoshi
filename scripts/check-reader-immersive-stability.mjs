import assert from 'node:assert/strict';
import fs from 'node:fs';
import { rectsOverlap } from '../src/lib/pageIndicatorLayout.js';

const reader = fs.readFileSync(new URL('../src/pages/Reader.jsx', import.meta.url), 'utf8');

assert.equal(rectsOverlap(
  { left: 0, right: 200, top: 0, bottom: 100 },
  { left: 80, right: 120, top: 99, bottom: 125 },
  6,
), true);
assert.match(reader, /indicator\.getBoundingClientRect\(\)/);
assert.match(reader, /pageIndicatorModeRef\.current === 'lowered'/);
assert.doesNotMatch(reader, /\}, \[isMobile, pageIndicatorMode, showTransientPageIndicator\]\)/);
assert.match(reader, /overlapFrame = requestAnimationFrame\(\(\) => \{[\s\S]*?checkIndicatorOverlap\(true\)/);
assert.match(reader, /if \(overlapFrame\) cancelAnimationFrame\(overlapFrame\)/);
assert.match(reader, /imgEl\.addEventListener\('load', scheduleOverlapCheck\)/);
assert.match(reader, /imgEl\.removeEventListener\('load', scheduleOverlapCheck\)/);

assert.match(reader, /\{viewMode === 'normal' && \(\s*<button[\s\S]*?沉浸模式/);
assert.match(reader, /\{viewMode === 'normal' && \([\s\S]*?<\/button>\s*\)\}\s*<button[\s\S]*?onClick=\{handleSetCover\}/);
assert.doesNotMatch(reader, /fullscreenExit|title=.*退出沉浸/);
assert.ok((reader.match(/display: 'none'/g) || []).length >= 3);
