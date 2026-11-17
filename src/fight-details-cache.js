// Provides the IndexedDB storage wrapper used for persistent raw fight-detail caching.
const DATABASE_NAME = 'berry-fflogs-cache';
const STORE_NAME = 'fight-details';
const DATABASE_VERSION = 1;

export function createFightDetailsCache() {
  let databasePromise = null;

  function open() {
    if (!('indexedDB' in window)) return Promise.resolve(null);
    if (!databasePromise) {
      databasePromise = new Promise((resolve) => {
        const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(STORE_NAME)) {
            database.createObjectStore(STORE_NAME);
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
        request.onblocked = () => resolve(null);
      });
    }
    return databasePromise;
  }

  async function get(key) {
    const database = await open();
    if (!database) return null;
    try {
      return await new Promise((resolve) => {
        const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }

  async function put(key, value) {
    const database = await open();
    if (!database) return;
    try {
      database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(value, key);
    } catch {
      // A cache write failure must never prevent a live FFLogs result from rendering.
    }
  }

  async function remove(key) {
    const database = await open();
    if (!database) return;
    await runTransaction(database, (store) => store.delete(key));
  }

  async function removePrefix(prefix) {
    const database = await open();
    if (!database) return;
    await runTransaction(database, (store) => {
      const request = store.openCursor(IDBKeyRange.bound(prefix, `${prefix}\uffff`));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      };
    });
  }

  async function entries() {
    const database = await open();
    if (!database) return null;
    return new Promise((resolve, reject) => {
      const results = [];
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        results.push([cursor.key, cursor.value]);
        cursor.continue();
      };
      transaction.oncomplete = () => resolve(results);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  return { entries, get, put, remove, removePrefix };
}

function runTransaction(database, mutate) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    mutate(transaction.objectStore(STORE_NAME));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
