/**
 * The browser database the UI keeps larger things in: the remembered packs folder handle and the
 * loaded pack files (localStorage holds text only, and too little of it for many packs).
 */

const DATABASE = "solo-horror-engine";
const VERSION = 2;
export const HANDLES_STORE = "handles";
export const LIBRARY_STORE = "library";
const STORES = [HANDLES_STORE, LIBRARY_STORE];

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      for (const store of STORES) {
        if (!request.result.objectStoreNames.contains(store))
          request.result.createObjectStore(store);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open storage"));
  });
}

export async function readStored(store: string, key: string): Promise<unknown> {
  const database = await openDatabase();
  try {
    return await new Promise<unknown>((resolve, reject) => {
      const request = database.transaction(store, "readonly").objectStore(store).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Storage request failed"));
    });
  } finally {
    database.close();
  }
}

/** Stores the value and resolves once the write is committed. */
export async function writeStored(store: string, key: string, value: unknown): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(store, "readwrite");
      transaction.objectStore(store).put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Storage request failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Storage write aborted"));
    });
  } finally {
    database.close();
  }
}
