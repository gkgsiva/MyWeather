// Past rain days of the TN-SMART gauges, shared by the gauge history (#gauges)
// and the rain spell summary (#spell).
//
// Each rain day is one JSON file of about 700 KB (every gauge, every hour).
// Only what the history needs is kept: each gauge's day total and position.
// Finished days never change, so they are saved on the phone (IndexedDB) and
// downloaded once; the running day is always read fresh.
//
// Normals: TN-SMART has none, so the gauge's district is compared with IMD's
// district normal for the week (mausam.imd.gov.in rainfall page, msg=W).
import { parseRainfallPage } from "./monsoon.js";

export const BASE = "https://beta-tnsmart.rimes.int/Rainfall_Python_IDW/Hourly_json/";
const DB = "myweather-gauges";
const STORE = "days";
const NORMAL_KEY = "myweather.gauges.normals";

// ---- Dates (IST); a rain day is named by the day it ends on, at 8:30 AM ----

const pad = (n) => String(n).padStart(2, "0");
export const dayKey = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const istNow = () => new Date(Date.now() + 5.5 * 3600 * 1000);
export function shiftDay(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return dayKey(d);
}
export function currentRainDay() {
  const t = istNow();
  const after = t.getUTCHours() * 60 + t.getUTCMinutes() >= 8 * 60 + 30;
  return after ? shiftDay(dayKey(t), 1) : dayKey(t);
}
export const niceDay = (day, opts = {}) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC", ...opts });
export const gaugeKey = (r) => `${r.district_name}|${r.station_name}`;

// ---- Saved days ----

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
function tx(mode, fn) {
  return db().then(
    (d) =>
      new Promise((resolve, reject) => {
        const t = d.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        t.oncomplete = () => resolve(req?.result);
        t.onerror = () => reject(t.error);
      })
  );
}
const getSaved = (day) => tx("readonly", (s) => s.get(day)).catch(() => undefined);
const putSaved = (day, value) => tx("readwrite", (s) => s.put(value, day)).catch(() => {});

// A day as { day, gauges: [[district, station, lat, lon, total|null, wettest hour|null]] },
// or { day, gauges: [] } when TN-SMART has no file for it.
export function compact(day, data) {
  const hours = Object.keys(data[0] || {}).filter((k) => /^\d\d:\d\d [AP]M$/.test(k));
  return {
    day,
    gauges: data
      .filter((r) => typeof r.latitude === "number" && typeof r.longitude === "number")
      .map((r) => {
        const v = hours.map((h) => r[h]).filter((x) => typeof x === "number");
        return [r.district_name, r.station_name, r.latitude, r.longitude, typeof r.total === "number" ? r.total : null, v.length ? Math.max(...v) : null];
      }),
  };
}

const memory = new Map(); // day -> compact day, for this session

async function fetchDay(day) {
  const res = await fetch(`${BASE}hourly_rainfall_${day}.json${day >= currentRainDay() ? `?t=${Date.now()}` : ""}`, {
    cache: day >= currentRainDay() ? "no-store" : "default",
  });
  if (res.status === 404) return { day, gauges: [] };
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return compact(day, await res.json());
}

/** Seeds the running day from rows already loaded by the gauges screen. */
export function remember(day, data) {
  const c = compact(day, data);
  memory.set(day, c);
  if (day < currentRainDay()) putSaved(day, c);
  return c;
}

/** One rain day (compact). The running day is cached for 10 minutes in memory only. */
export async function getDay(day) {
  const m = memory.get(day);
  const running = day >= currentRainDay();
  if (m && (!running || Date.now() - (m.at || 0) < 10 * 60 * 1000)) return m;
  if (!running) {
    const saved = await getSaved(day);
    if (saved?.gauges) {
      memory.set(day, saved);
      return saved;
    }
  }
  const c = await fetchDay(day);
  c.at = Date.now();
  memory.set(day, c);
  // An empty answer for a recent day may only be late; don't keep it.
  if (!running && (c.gauges.length || day < shiftDay(currentRainDay(), -3))) putSaved(day, c);
  return c;
}

/** How many of these days still need downloading. */
export async function missing(days) {
  let n = 0;
  for (const d of days) {
    if (memory.has(d) && d < currentRainDay()) continue;
    if (d >= currentRainDay() || !(await getSaved(d))?.gauges) n++;
  }
  return n;
}

/** Several days, four downloads at a time. onProgress(done, total). Days that fail come back as null. */
export async function getDays(days, onProgress) {
  const out = new Array(days.length).fill(null);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < days.length) {
      const i = next++;
      try {
        out[i] = await getDay(days[i]);
      } catch {
        out[i] = null;
      }
      onProgress?.(++done, days.length);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return out;
}

/** The N rain days ending on `end`, oldest first. */
export const daysEnding = (end, n) => Array.from({ length: n }, (_, i) => shiftDay(end, i - n + 1));

// ---- IMD district normals ----

// TN-SMART's district names where IMD spells them differently.
const IMD_NAME = {
  Kallakurichi: "KALLAKKURICHI",
  Kanniyakumari: "KANYAKUMARI",
  Thoothukudi: "TUTICORIN",
  Tirunelveli: "THIRUNELVELI",
  Tirupathur: "TIRUPATTUR",
  Tiruppur: "THIRUPPUR",
  Tiruvallur: "THIRUVALLUR",
  Tiruvannamalai: "THIRUVANNAMALAI",
};
export const imdDistrict = (name) => IMD_NAME[name] || String(name).toUpperCase();

/**
 * IMD's weekly district figures: { date, areas: { NAME: { actual, normal, departure } } }.
 * Kept for 12 hours. Needs the app (IMD sends no CORS header).
 */
export async function weeklyNormals() {
  try {
    const saved = JSON.parse(localStorage.getItem(NORMAL_KEY));
    if (saved && Date.now() - saved.at < 12 * 3600 * 1000) return saved.data;
  } catch {}
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 40000);
  try {
    const res = await fetch("https://mausam.imd.gov.in/responsive/rainfallinformation.php?msg=W", { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { areas, date } = parseRainfallPage(await res.text());
    if (!Object.keys(areas).length) throw new Error("no figures");
    const data = { areas, date };
    try {
      localStorage.setItem(NORMAL_KEY, JSON.stringify({ at: Date.now(), data }));
    } catch {}
    return data;
  } finally {
    clearTimeout(timer);
  }
}
