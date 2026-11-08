// A small IndexedDB key-value helper for saved radar and records data
// ("myweather-radar": bg = each radar's bare map for the data saver, misc =
// storm motion and the Rain records figures). Every call fails soft: a phone
// without IndexedDB just keeps nothing.
const NAME = "myweather-radar";
const STORES = ["bg", "rain", "misc"];

let dbPromise;
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, 1);
    req.onupgradeneeded = () => {
      for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return db().then(
    (d) =>
      new Promise((resolve, reject) => {
        const t = d.transaction(store, mode);
        const req = fn(t.objectStore(store));
        t.oncomplete = () => resolve(req?.result);
        t.onerror = () => reject(t.error);
      })
  );
}

export const idbGet = (store, key) => tx(store, "readonly", (s) => s.get(key)).catch(() => undefined);
export const idbPut = (store, key, value) => tx(store, "readwrite", (s) => s.put(value, key)).catch(() => {});
export const idbDelete = (store, key) => tx(store, "readwrite", (s) => s.delete(key)).catch(() => {});
export const idbKeys = (store) => tx(store, "readonly", (s) => s.getAllKeys()).catch(() => []);
