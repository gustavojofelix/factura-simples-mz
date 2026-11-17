/**
 * Armazenamento chave/valor em IndexedDB para o modo offline da app nativa.
 * Falhas (IndexedDB indisponível, quota) são silenciosas: o cache é só uma ajuda.
 */
const DB_NAME = 'ispc-offline';
const STORE = 'responses';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise(resolve => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
  return openDb().then(db => new Promise<T | undefined>(resolve => {
    if (!db) return resolve(undefined);
    try {
      const request = op(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  }));
}

export const offlineStore = {
  get<T>(key: string): Promise<T | undefined> {
    return run<T>('readonly', s => s.get(key));
  },
  set(key: string, value: unknown): Promise<void> {
    return run('readwrite', s => s.put(value, key)).then(() => undefined);
  },
  clear(): Promise<void> {
    return run('readwrite', s => s.clear()).then(() => undefined);
  }
};
