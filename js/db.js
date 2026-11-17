// Lokale Speicherung in IndexedDB (nur auf diesem Gerät).
// "state" = aktuelle Daten, "previous" = letzte gültige Generation, "photos" = Bilddaten als Blob.
const DB_NAME = 'masse';
let dbPromise;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(stores, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    Promise.resolve(fn(t)).then(r => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Speichern abgebrochen'));
  }));
}
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const loadState = () => tx(['kv'], 'readonly', t => req(t.objectStore('kv').get('state')));
export const loadPrevious = () => tx(['kv'], 'readonly', t => req(t.objectStore('kv').get('previous')));

/** Atomar: alte Generation wird "previous", neue wird "state". */
export function saveState(next, prev) {
  return tx(['kv'], 'readwrite', t => {
    const kv = t.objectStore('kv');
    if (prev) kv.put(prev, 'previous');
    kv.put(next, 'state');
  });
}

export const putPhoto = (id, blob) => tx(['photos'], 'readwrite', t => { t.objectStore('photos').put(blob, id); });
export const getPhoto = id => tx(['photos'], 'readonly', t => req(t.objectStore('photos').get(id)));
export const deletePhoto = id => tx(['photos'], 'readwrite', t => { t.objectStore('photos').delete(id); });

export function clearAll() {
  return tx(['kv', 'photos'], 'readwrite', t => { t.objectStore('kv').clear(); t.objectStore('photos').clear(); });
}

/** Bittet den Browser, die Daten nicht automatisch zu löschen. */
export async function requestPersistence() {
  try {
    if (!navigator.storage?.persist) return null;
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch { return null; }
}
export async function storageEstimate() {
  try { return await navigator.storage?.estimate?.(); } catch { return null; }
}
