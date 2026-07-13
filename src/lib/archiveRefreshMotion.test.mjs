import test from 'node:test';
import assert from 'node:assert/strict';
import { reduceArchiveRefreshPhase } from './archiveRefreshMotion.js';

test('refresh phases cover replacement lifecycle', () => {
  assert.equal(reduceArchiveRefreshPhase('idle', 'start'), 'exiting');
  assert.equal(reduceArchiveRefreshPhase('exiting', 'replace'), 'entering');
  assert.equal(reduceArchiveRefreshPhase('entering', 'finish'), 'idle');
});

test('failed refresh restores visible state', () => {
  assert.equal(reduceArchiveRefreshPhase('exiting', 'fail'), 'idle');
  assert.equal(reduceArchiveRefreshPhase('entering', 'fail'), 'idle');
});
