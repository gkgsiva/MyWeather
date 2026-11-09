// Rain at the saved Wunderground stations over any window of time, for the
// Rainfall cards (#distrank): the rain day to 8:30 AM or the last few hours.
//
// Wunderground's 5-minute observations carry precipTotal, the rain since the
// station's local midnight, so the rain in a window is the sum of its rises
// between readings inside it. Today comes from observations/all/1day, earlier
// days from history/all (one request per station per day). Finished rain-day
// totals are kept on the phone, so a past day is only downloaded once.
import { loadStations } from "./wunderground.js";
import { get, KeyError, LimitError } from "./rain.js";

const SAVED_KEY = "myweather.rcards.pws"; // { rainDay: { id: mm | null } }
const memo = new Map(); // "id|YYYY-MM-DD" -> { at, obs: [[epoch, date, precipTotal]] }

const pad = (n) => String(n).padStart(2, "0");
const localDay = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readSaved() {
  try {
    return JSON.parse(localStorage.getItem(SAVED_KEY)) || {};
  } catch {
    return {};
  }
}
function writeSaved(all) {
  const keep = Object.keys(all).sort().slice(-40);
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(Object.fromEntries(keep.map((k) => [k, all[k]]))));
  } catch {}
}

/** The saved stations, one per ID (two nicknames can share a station). */
export function pwsStations() {
  const seen = new Map();
  for (const s of loadStations()) if (!seen.has(s.id)) seen.set(s.id, s.name);
  return [...seen].map(([id, name]) => ({ id, name }));
}

async function dayObs(id, day) {
  const today = day === localDay(Date.now());
  const k = `${id}|${day}`;
  const m = memo.get(k);
  if (m && (!today || Date.now() - m.at < 5 * 60 * 1000)) return { obs: m.obs, fresh: false };
  const body = today
    ? await get("observations/all/1day", { stationId: id })
    : await get("history/all", { stationId: id, date: day.replaceAll("-", "") });
  const obs = (body?.observations || [])
    .map((o) => [o.epoch * 1000, String(o.obsTimeLocal || "").slice(0, 10), o.metric?.precipTotal])
    .filter(([t, d, p]) => t && d && typeof p === "number")
    .sort((a, b) => a[0] - b[0]);
  memo.set(k, { at: Date.now(), obs });
  return { obs, fresh: true };
}

// Rain in (start, end] from readings of rain since midnight; null with no reading in the window.
function windowRain(obs, start, end) {
  let total = null;
  let prev = null;
  for (const [t, day, p] of obs) {
    let inc = 0;
    if (prev && prev[1] === day) inc = Math.max(0, p - prev[2]);
    else {
      // The day's first reading: its total is the rain since midnight, if it is close to midnight.
      const d = new Date(t);
      if (d.getHours() === 0 && d.getMinutes() < 15) inc = p;
    }
    if (t > start && t <= end) total = (total || 0) + inc;
    prev = [t, day, p];
  }
  return total;
}

/**
 * Rain at every saved station between start and end (ms). rainDay names a
 * finished rain day to keep the totals of. onProgress(done, total) after each
 * station. Returns [{ id, name, total }] (total null when it sent nothing).
 * Throws KeyError without a Wunderground key.
 */
export async function pwsRain(start, end, { rainDay = "", onProgress, cancelled } = {}) {
  const stations = pwsStations();
  const saved = rainDay ? readSaved() : {};
  const kept = rainDay && saved[rainDay];
  if (kept && stations.every((s) => s.id in kept)) return stations.map((s) => ({ ...s, total: kept[s.id] }));
  const days = [];
  for (let d = localDay(start + 1); d <= localDay(end); ) {
    days.push(d);
    const n = new Date(`${d}T12:00:00`);
    n.setDate(n.getDate() + 1);
    d = localDay(n.getTime());
  }
  // Up to 30 requests a minute on a station owner's key.
  const many = stations.length * days.length > 25;
  const out = [];
  let done = 0;
  for (const s of stations) {
    if (cancelled?.()) return null;
    if (kept && s.id in kept) {
      out.push({ ...s, total: kept[s.id] });
      onProgress?.(++done, stations.length);
      continue;
    }
    let obs = [];
    for (const day of days) {
      for (;;) {
        try {
          const r = await dayObs(s.id, day);
          obs = obs.concat(r.obs);
          if (r.fresh && many) await sleep(2100);
          break;
        } catch (e) {
          if (e instanceof KeyError) throw e;
          if (e instanceof LimitError) {
            await sleep(60000);
            continue;
          }
          break; // this station's day failed; leave it out
        }
      }
    }
    out.push({ ...s, total: windowRain(obs, start, end) });
    onProgress?.(++done, stations.length);
  }
  if (rainDay) {
    saved[rainDay] = Object.fromEntries(out.map((s) => [s.id, s.total]));
    writeSaved(saved);
  }
  return out;
}

export { KeyError };
