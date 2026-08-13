const DB_NAME = "tu-prima-offline";
const DB_VERSION = 1;
const OUTBOX = "outbox";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(OUTBOX)) {
        db.createObjectStore(OUTBOX, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("IndexedDB tx failed"));
    tx.onabort = () => reject(tx.error || new Error("IndexedDB tx aborted"));
  });
}

export async function idbPut<T>(store: string, value: T): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    await txDone(tx);
  } finally {
    db.close();
  }
}

export async function idbGetAll<T>(store: string): Promise<T[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).getAll();
    const rows = await new Promise<T[]>((resolve, reject) => {
      req.onsuccess = () => resolve((req.result as T[]) || []);
      req.onerror = () => reject(req.error || new Error("IndexedDB getAll failed"));
    });
    await txDone(tx);
    return rows;
  } finally {
    db.close();
  }
}

export async function idbDelete(store: string, key: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    await txDone(tx);
  } finally {
    db.close();
  }
}

export const OUTBOX_STORE = OUTBOX;
