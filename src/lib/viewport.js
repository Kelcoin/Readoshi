import { useSyncExternalStore } from 'react';

const subscribers = new Set();
let listening = false;

function emit() { subscribers.forEach((subscriber) => subscriber()); }
function subscribe(subscriber) {
  subscribers.add(subscriber);
  if (!listening && typeof window !== 'undefined') {
    window.addEventListener('resize', emit, { passive: true });
    listening = true;
  }
  return () => {
    subscribers.delete(subscriber);
    if (listening && subscribers.size === 0 && typeof window !== 'undefined') {
      window.removeEventListener('resize', emit);
      listening = false;
    }
  };
}
function getSnapshot() { return typeof window === 'undefined' ? 1024 : window.innerWidth; }

export function useViewportWidth() {
  return useSyncExternalStore(subscribe, getSnapshot, () => 1024);
}
