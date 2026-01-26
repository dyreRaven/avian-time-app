// Lightweight offline key/value store with IndexedDB preferred and localStorage fallback.
// Values are stored as structured objects in IDB and JSON in localStorage.

(function () {
  const DB_NAME = 'avian-offline';
  const STORE_NAME = 'kv';
  const DB_VERSION = 1;

  let dbPromise = null;
  let ready = false;
  let useIdb = false;
  const memory = new Map();

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('indexedDB not available'));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error || new Error('indexedDB open failed'));
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
    });
    return dbPromise;
  }

  function idbGet(key) {
    return openDb().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onerror = () => reject(req.error || new Error('indexedDB get failed'));
      req.onsuccess = () => {
        resolve(req.result ? req.result.value : undefined);
      };
    }));
  }

  function idbSet(key, value) {
    return openDb().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put({ key, value });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('indexedDB set failed'));
    }));
  }

  function idbDelete(key) {
    return openDb().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('indexedDB delete failed'));
    }));
  }

  function readLocal(key) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null || raw === undefined) return undefined;
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }

  function writeLocal(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore
    }
  }

  function removeLocal(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }

  async function init(keys = []) {
    if (ready) return;
    try {
      await openDb();
      useIdb = true;
    } catch {
      useIdb = false;
    }

    if (Array.isArray(keys) && keys.length) {
      for (const key of keys) {
        let value;
        if (useIdb) {
          try {
            value = await idbGet(key);
          } catch {
            value = undefined;
          }
        }
        if (value === undefined) {
          value = readLocal(key);
        }
        if (value !== undefined) {
          memory.set(key, value);
        }
      }
    }

    ready = true;
  }

  function get(key, fallback) {
    if (memory.has(key)) return memory.get(key);
    const local = readLocal(key);
    if (local !== undefined) {
      memory.set(key, local);
      return local;
    }
    return fallback;
  }

  function set(key, value) {
    memory.set(key, value);
    if (useIdb) {
      idbSet(key, value).catch(() => writeLocal(key, value));
    } else {
      writeLocal(key, value);
    }
  }

  function remove(key) {
    memory.delete(key);
    if (useIdb) {
      idbDelete(key).catch(() => removeLocal(key));
    } else {
      removeLocal(key);
    }
  }

  window.AVIAN_STORE = {
    init,
    get,
    set,
    remove,
    isReady: () => ready,
    isIdb: () => useIdb
  };
})();
