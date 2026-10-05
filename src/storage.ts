/** IndexedDB 키-값 저장소. 사용할 수 없으면 메모리로 대체하고 사용자에게 알린다. */
const DB = "lotto-workroom";
const STORE = "kv";

let dbp: Promise<IDBDatabase> | null = null;
const mem = new Map<string, unknown>();
export let persistent = true;

function open(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) {
      reject(e);
    }
  });
  return dbp;
}

export async function load<T>(key: string, fallback: T): Promise<T> {
  try {
    const db = await open();
    return await new Promise<T>((resolve, reject) => {
      const r = db.transaction(STORE).objectStore(STORE).get(key);
      r.onsuccess = () => resolve((r.result as T | undefined) ?? fallback);
      r.onerror = () => reject(r.error);
    });
  } catch {
    persistent = false;
    return (mem.get(key) as T | undefined) ?? fallback;
  }
}

/** 저장 성공 여부를 돌려준다. */
export async function save(key: string, value: unknown): Promise<boolean> {
  mem.set(key, value);
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return true;
  } catch {
    persistent = false;
    return false;
  }
}
