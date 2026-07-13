export function reduceArchiveRefreshPhase(phase, event) {
  if (event === 'fail' || event === 'finish') return 'idle';
  if (phase === 'idle' && event === 'start') return 'exiting';
  if (phase === 'exiting' && event === 'replace') return 'entering';
  return phase;
}
