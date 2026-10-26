// IndexedDB store of tile image bytes, keyed "z/x/y" (XYZ scheme).
// ArrayBuffers rather than Blobs: older iOS Safari versions were unreliable with stored Blobs.

const DB_NAME = 'offlinesat';
const STORE = 'tiles';

let dbPromise;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      request.onerror = () => {
        dbPromise = undefined;
        reject(request.error);
      };
    });
  }
  return dbPromise;
}

async function transaction(mode, work) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const result = work(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(result instanceof IDBRequest ? result.result : result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Storage transaction aborted'));
  });
}

export const tileStore = {
  get: (key) => transaction('readonly', (store) => store.get(key)),
  /** First stored value among `keys`, in order, using one transaction. */
  getFirst: async (keys) => {
    const requests = await transaction('readonly', (store) => keys.map((key) => store.get(key)));
    for (const request of requests) {
      if (request.result !== undefined) return request.result;
    }
    return undefined;
  },
  has: async (key) => (await transaction('readonly', (store) => store.count(key))) > 0,
  put: (key, data) => transaction('readwrite', (store) => { store.put(data, key); }),
  putMany: (entries) => transaction('readwrite', (store) => {
    for (const [key, data] of entries) store.put(data, key);
  }),
  count: () => transaction('readonly', (store) => store.count()),
  clear: () => transaction('readwrite', (store) => { store.clear(); }),
};
