// Keeps the last radar images (IndexedDB) so they stay visible when the
// network drops, as it often does in heavy rain. Each entry is
// { blob, savedAt, imdTime } keyed by the image URL; only the newest few are kept.
const DB = "myweather";
const STORE = "images";
const KEEP = 12;

let dbPromise;
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function run(mode, fn) {
  return db().then(
    (d) =>
      new Promise((resolve, reject) => {
        const tx = d.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req?.result);
        tx.onerror = () => reject(tx.error);
      })
  );
}

export async function saveImage(url, entry) {
  try {
    await run("readwrite", (s) => s.put(entry, url));
    // Drop the oldest entries beyond KEEP.
    const all = await run("readonly", (s) => s.getAll());
    const keys = await run("readonly", (s) => s.getAllKeys());
    if (keys.length > KEEP) {
      const order = keys.map((k, i) => [k, all[i].savedAt]).sort((a, b) => a[1] - b[1]);
      const drop = order.slice(0, keys.length - KEEP).map(([k]) => k);
      await run("readwrite", (s) => {
        for (const k of drop) s.delete(k);
      });
    }
  } catch {}
}

export async function loadImage(url) {
  try {
    return (await run("readonly", (s) => s.get(url))) || null;
  } catch {
    return null;
  }
}

// "10:42" today, "5 Nov, 10:42" on another day.
export function when(ms) {
  const d = new Date(ms);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString()
    ? time
    : `${d.toLocaleDateString([], { day: "numeric", month: "short" })}, ${time}`;
}
