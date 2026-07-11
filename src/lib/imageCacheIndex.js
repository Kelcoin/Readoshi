const DB_NAME = 'lrr-image-cache-index-v1';
const STORE = 'entries';

function openDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, operation) {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = operation(tx.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).finally(() => db.close());
}

export const imageCacheIndex = {
  put(entry) { return withStore('readwrite', store => store.put(entry)); },
  delete(key) { return withStore('readwrite', store => store.delete(key)); },
  clear() { return withStore('readwrite', store => store.clear()); },
  all() { return withStore('readonly', store => store.getAll()).then(value => value || []); },
};
