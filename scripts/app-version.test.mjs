import test from 'node:test';
import assert from 'node:assert/strict';
import { bumpVersion, classifySemverBump } from './app-version.mjs';

test('classifies source changes as a minor dev version bump', () => {
  assert.equal(classifySemverBump(['src/App.jsx'], []), 'minor');
  assert.equal(bumpVersion('1.2.3', 'minor'), '1.3.0');
});

test('classifies docs-only changes as patch and breaking commits as major', () => {
  assert.equal(classifySemverBump(['README.md'], []), 'patch');
  assert.equal(classifySemverBump(['src/App.jsx'], ['feat!: replace settings storage']), 'major');
});
