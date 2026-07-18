const DB_NAME = 'lrr-image-cache-index-v1';
const STORE = 'entries';
const BLOB_STORE = 'blobs';

function openDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: 'key' });
      }
      if (!request.result.objectStoreNames.contains(BLOB_STORE)) {
        request.result.createObjectStore(BLOB_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(storeName, mode, operation) {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const request = operation(tx.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).finally(() => db.close());
}

export const imageCacheIndex = {
  put(entry) { return withStore(STORE, 'readwrite', store => store.put(entry)); },
  putBlob(key, blob) { return withStore(BLOB_STORE, 'readwrite', store => store.put({ key, blob })); },
  getBlob(key) {
    return withStore(BLOB_STORE, 'readonly', store => store.get(key))
      .then(value => value?.blob || null);
  },
  deleteBlob(key) { return withStore(BLOB_STORE, 'readwrite', store => store.delete(key)); },
  delete(key) {
    return Promise.all([
      withStore(STORE, 'readwrite', store => store.delete(key)),
      withStore(BLOB_STORE, 'readwrite', store => store.delete(key)),
    ]);
  },
  clear() {
    return Promise.all([
      withStore(STORE, 'readwrite', store => store.clear()),
      withStore(BLOB_STORE, 'readwrite', store => store.clear()),
    ]);
  },
  all() { return withStore(STORE, 'readonly', store => store.getAll()).then(value => value || []); },
};
