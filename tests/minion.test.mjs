import assert from 'node:assert/strict';
import test from 'node:test';

import * as api from '../src/lib/api.js';

test('Minion waiter retains one job ID until it finishes', async () => {
  assert.equal(typeof api.waitForMinionJob, 'function', 'waitForMinionJob must exist');
  const seen = [];
  const states = ['inactive', 'active', 'finished'];
  const result = await api.waitForMinionJob({ job: 42 }, {
    pollMs: 0,
    timeoutMs: 100,
    getStatus: async (jobId) => {
      seen.push(jobId);
      return { state: states.shift() };
    },
  });
  assert.equal(result.state, 'finished');
  assert.deepEqual(seen, [42, 42, 42]);
});

test('Minion waiter times out instead of locking the page forever', async () => {
  assert.equal(typeof api.waitForMinionJob, 'function', 'waitForMinionJob must exist');
  await assert.rejects(
    api.waitForMinionJob({ job: 9 }, {
      pollMs: 1,
      timeoutMs: 5,
      getStatus: async () => ({ state: 'active' }),
    }),
    /超时/,
  );
});
