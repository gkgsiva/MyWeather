// The places you saved (My places), kept on the phone in localStorage.
// Each is { id, name, lat, lon }. Model charts and My places both read this.
const KEY = "myweather.places";
export const MAX_PLACES = 12;

export function savedPlaces() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(list)
      ? list.filter((p) => p && typeof p.id === "string" && typeof p.name === "string" && Number.isFinite(p.lat) && Number.isFinite(p.lon))
      : [];
  } catch {
    return [];
  }
}

function write(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {}
  window.dispatchEvent(new Event("myweather:places"));
}

/** Saves a place (a place within about 1 km of a saved one is the same place). Returns the saved place, or null when the list is full. */
export function addPlace({ name, lat, lon }) {
  const list = savedPlaces();
  const same = list.find((p) => Math.abs(p.lat - lat) < 0.01 && Math.abs(p.lon - lon) < 0.01);
  if (same) return same;
  if (list.length >= MAX_PLACES) return null;
  const p = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: String(name).trim().slice(0, 40) || "My place", lat: +lat.toFixed(4), lon: +lon.toFixed(4) };
  write([...list, p]);
  return p;
}

export function removePlace(id) {
  write(savedPlaces().filter((p) => p.id !== id));
}

export function renamePlace(id, name) {
  const n = String(name).trim().slice(0, 40);
  if (n) write(savedPlaces().map((p) => (p.id === id ? { ...p, name: n } : p)));
}

// Where Model charts has data: the grid over Tamil Nadu and about 40 km round it.
export const inModelGrid = (lat, lon) => lat >= 8 && lat <= 13.75 && lon >= 76 && lon <= 80.5;
