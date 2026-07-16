let owners = 0;
let previousBodyOverflow = '';
let previousRootOverflow = '';

export function acquireBodyScrollLock() {
  if (typeof document === 'undefined') return () => {};
  if (owners === 0) {
    previousBodyOverflow = document.body.style.overflow;
    previousRootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
  }
  owners += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    owners = Math.max(0, owners - 1);
    if (owners !== 0) return;
    document.body.style.overflow = previousBodyOverflow;
    document.documentElement.style.overflow = previousRootOverflow;
  };
}
