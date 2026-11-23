// Weather for a saved place (My places): now, the last 7 days and the next 7
// days of temperature, rain, wind and humidity, from Open-Meteo (free, no key),
// and the nearest TN-SMART rain gauge with what it measured. Both are kept on
// the phone, so the last look still shows with no signal.
import { idbGet, idbPut } from "./idb.js";
import { getDays, daysEnding, currentRainDay, niceDay } from "./gaugedays.js";
import { km } from "./geo.js";
import { savingData } from "./datasaver.js";

const FRESH_MS = 15 * 60 * 1000;
/** A gauge farther than this is not "near" the place. */
export const GAUGE_KM = 15;

/** { at, stale?, data } where data is Open-Meteo's answer: current, daily (7 days back, 7 ahead), hourly rain chance. */
export async function placeWeather(p, force = false) {
  const key = `places.wx.${p.lat.toFixed(2)},${p.lon.toFixed(2)}`;
  const hit = await idbGet("misc", key);
  if (!force && hit && Date.now() - hit.at < FRESH_MS) return hit;
  if (hit && navigator.onLine === false) return { ...hit, stale: true, offline: true };
  const q = new URLSearchParams({
    latitude: String(p.lat),
    longitude: String(p.lon),
    timezone: "Asia/Kolkata",
    past_days: "7",
    forecast_days: "8",
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,precipitation",
    daily:
      "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,relative_humidity_2m_mean",
  });
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`);
    if (res.status === 429) throw new Error("limit");
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.reason || `HTTP ${res.status}`);
    const out = { at: Date.now(), data };
    await idbPut("misc", key, out);
    return out;
  } catch (e) {
    if (hit) return { ...hit, stale: true };
    throw e;
  }
}

/**
 * The nearest gauge within GAUGE_KM that reported rain figures on the latest
 * rain day, with its last 7 rain days (2 with the data saver on) (8:30 AM to 8:30 AM).
 * Returns { gauge: { name, district, km, days: [{ day, mm }] }, day, stale } or { none: true, nearest } when no gauge is that close.
 */
export async function nearestGauge(p, force = false) {
  const key = `places.gauge.${p.lat.toFixed(2)},${p.lon.toFixed(2)}`;
  const hit = await idbGet("misc", key);
  if (!force && hit && Date.now() - hit.at < FRESH_MS) return hit;
  if (hit && navigator.onLine === false) return { ...hit, stale: true, offline: true };
  try {
    const end = currentRainDay();
    // Each finished day is one 700 KB file, downloaded once; with the data saver on, only the last 2 days.
    const names = daysEnding(end, savingData() ? 2 : 7);
    const days = await getDays(names);
    if (days.every((d) => !d)) throw new Error("no gauge data");
    // The running day didn't load (signal dropped): keep the last full reading rather than replace it with older days.
    if (!days[days.length - 1] && hit?.gauge) return { ...hit, stale: true };
    // Gauges that reported on any of these days, nearest first.
    const near = new Map();
    for (const d of days) {
      for (const g of d?.gauges || []) {
        if (typeof g[4] !== "number") continue;
        const id = `${g[0]}|${g[1]}`;
        if (!near.has(id)) near.set(id, { id, name: g[1], district: g[0], d: km([p.lat, p.lon], [g[2], g[3]]) });
      }
    }
    const sorted = [...near.values()].sort((a, b) => a.d - b.d);
    const best = sorted[0];
    let out;
    if (!best || best.d > GAUGE_KM) {
      out = { at: Date.now(), none: true, nearest: best ? { name: best.name, district: best.district, km: best.d } : null };
    } else {
      const series = days.map((d, i) => {
        const g = d?.gauges.find((x) => `${x[0]}|${x[1]}` === best.id);
        return { day: names[i], mm: d ? (g && typeof g[4] === "number" ? g[4] : null) : null };
      });
      out = { at: Date.now(), gauge: { name: best.name, district: best.district, km: best.d, days: series } };
    }
    await idbPut("misc", key, out);
    return out;
  } catch (e) {
    if (hit) return { ...hit, stale: true };
    throw e;
  }
}

export { niceDay };
