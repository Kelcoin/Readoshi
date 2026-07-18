import assert from 'node:assert/strict';
import test from 'node:test';
import * as readerUiState from '../src/lib/readerUiState.js';
import { resolveReaderToolbarMode } from '../src/lib/readerUiState.js';

test('reader toolbar title uses the symmetric space left between control groups', () => {
  assert.equal(typeof readerUiState.getCenteredToolbarTitleWidth, 'function');
  assert.equal(readerUiState.getCenteredToolbarTitleWidth({
    toolbar: { left: 0, right: 2000 },
    leftGroup: { right: 150 },
    rightGroup: { left: 1700 },
    gap: 16,
  }), 1368);
  assert.equal(readerUiState.getCenteredToolbarTitleWidth({
    toolbar: { left: 0, right: 600 },
    leftGroup: { right: 310 },
    rightGroup: { left: 450 },
    gap: 16,
  }), 0);
});

test('reader toolbar degrades from text to icons before hiding its title', () => {
  const widths = { isMobile: false, fullRequiredWidth: 1100, iconRequiredWidth: 760 };
  assert.equal(resolveReaderToolbarMode({ ...widths, availableWidth: 1200 }), 'full');
  assert.equal(resolveReaderToolbarMode({ ...widths, availableWidth: 900 }), 'icons');
  assert.equal(resolveReaderToolbarMode({ ...widths, availableWidth: 700 }), 'mobile');
});

test('reader toolbar restores richer modes when space returns and mobile stays icon-only', () => {
  const widths = { isMobile: false, fullRequiredWidth: 1000, iconRequiredWidth: 700 };
  assert.equal(resolveReaderToolbarMode({ ...widths, availableWidth: 680 }), 'mobile');
  assert.equal(resolveReaderToolbarMode({ ...widths, availableWidth: 760 }), 'icons');
  assert.equal(resolveReaderToolbarMode({ ...widths, availableWidth: 1080 }), 'full');
  assert.equal(resolveReaderToolbarMode({ ...widths, isMobile: true, availableWidth: 1400 }), 'mobile');
});

test('reader toolbar switches to icons before text reaches the title', () => {
  assert.equal(resolveReaderToolbarMode({
    isMobile: false,
    availableWidth: 1020,
    fullRequiredWidth: 1000,
    iconRequiredWidth: 700,
  }), 'icons');
});
