export const IMAGE_LOAD_PRIORITY = Object.freeze({
  CRITICAL: 300,
  NORMAL: 200,
  ADJACENT: 100,
  PRELOAD: 0,
});

export function createImageLoadQueue({ maxConcurrent = 3 } = {}) {
  const limit = Math.max(2, Number(maxConcurrent) || 3);
  const backgroundLimit = Math.max(1, limit - 1);
  const pending = new Map();
  const queued = [];
  const active = new Set();
  let sequence = 0;

  const isCritical = (job) => job.priority >= IMAGE_LOAD_PRIORITY.CRITICAL;

  function pump() {
    while (queued.length > 0 && active.size < limit) {
      const criticalWaiting = queued.some(isCritical);
      const criticalActive = [...active].some(isCritical);
      if (criticalActive && !criticalWaiting) return;

      queued.sort((a, b) => (b.priority - a.priority) || (a.sequence - b.sequence));
      const candidateIndex = criticalWaiting ? queued.findIndex(isCritical) : 0;
      const job = queued[candidateIndex];
      if (!isCritical(job) && active.size >= backgroundLimit) return;

      queued.splice(candidateIndex, 1);
      job.state = 'active';
      active.add(job);

      Promise.resolve()
        .then(job.task)
        .then(job.resolve, job.reject)
        .finally(() => {
          active.delete(job);
          if (pending.get(job.key) === job) pending.delete(job.key);
          pump();
        });
    }
  }

  function schedule(key, task, priority = IMAGE_LOAD_PRIORITY.NORMAL) {
    const existing = pending.get(key);
    if (existing) {
      if (priority > existing.priority) {
        existing.priority = priority;
        if (existing.state === 'queued') pump();
      }
      return existing.promise;
    }

    const job = {
      key,
      task,
      priority,
      sequence: sequence++,
      state: 'queued',
    };
    job.promise = new Promise((resolve, reject) => {
      job.resolve = resolve;
      job.reject = reject;
    });
    pending.set(key, job);
    queued.push(job);
    pump();
    return job.promise;
  }

  return { schedule };
}
