// Sea and tides (#sea): high and low tide times off the Chennai coast and the
// sea state (wave height, swell, period, sea temperature) for the next three
// days, from Open-Meteo's marine forecast (marine-api.open-meteo.com, no key).
//
// Tide times are read from the forecast sea level (sea_level_height_msl, which
// includes the tide), as the turning points of the hourly curve, refined
// between hours. Open-Meteo says this model is not accurate enough for coastal
// navigation, so the times are a guide, good to about half an hour.
import { drawLines } from "./chart.js";
import { when } from "./offline.js";

// Just off Marina Beach.
const SPOT = { lat: 13.05, lon: 80.3 };
const SAVED_KEY = "myweather.sea.last";
const TTL = 30 * 60 * 1000;
const URL_SEA =
  "https://marine-api.open-meteo.com/v1/marine?" +
  new URLSearchParams({
    latitude: SPOT.lat,
    longitude: SPOT.lon,
    timezone: "Asia/Kolkata",
    forecast_days: 3,
    hourly: "sea_level_height_msl,wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_period",
    current: "wave_height,wave_direction,wave_period,swell_wave_height,sea_surface_temperature",
    daily: "wave_height_max",
  });

const $ = (id) => document.getElementById(id);
const status = $("sea-status");
let loadedAt = 0;

function say(text, error = false) {
  status.textContent = text;
  status.className = error ? "status error" : "status";
}

// Douglas sea scale, by wave height in metres.
const SEA_STATES = [
  [0.1, "Calm"],
  [0.5, "Smooth"],
  [1.25, "Slight"],
  [2.5, "Moderate"],
  [4, "Rough"],
  [6, "Very rough"],
  [9, "High"],
  [14, "Very high"],
  [Infinity, "Phenomenal"],
];
export const seaState = (h) => (typeof h === "number" ? SEA_STATES.find(([max]) => h < max)[1] : "–");

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
// Waves are given by the direction they come from.
const from = (deg) => (typeof deg === "number" ? `from the ${COMPASS[Math.round(deg / 45) % 8]}` : "");
const m1 = (v) => (typeof v === "number" ? v.toFixed(1) : "–");
const m2 = (v) => (typeof v === "number" ? v.toFixed(2) : "–");
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// High and low tides: turning points of the hourly sea level, with the time
// and height refined by fitting a parabola through the three hours around it.
export function findTides(times, levels) {
  const out = [];
  for (let i = 1; i < levels.length - 1; i++) {
    const [a, b, c] = [levels[i - 1], levels[i], levels[i + 1]];
    if ([a, b, c].some((v) => typeof v !== "number")) continue;
    const high = b > a && b >= c;
    const low = b < a && b <= c;
    if (!high && !low) continue;
    const den = a - 2 * b + c;
    const off = den ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
    const height = b - 0.25 * (a - c) * off;
    out.push({ index: i + off, time: shiftTime(times[i], off), height, high });
  }
  return out;
}

// "2026-11-06T14:00" plus a fraction of an hour, as local "HH:MM" and the day.
function shiftTime(t, hours) {
  const base = Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10), +t.slice(11, 13), +t.slice(14, 16));
  const d = new Date(base + Math.round(hours * 60) * 60000);
  return d.toISOString().slice(0, 16);
}

const localHour = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 13) + ":00";

function render(data) {
  const h = data.hourly;
  const c = data.current || {};
  const now = Math.max(0, h.time.findIndex((t) => t >= localHour()));
  const wave = c.wave_height ?? h.wave_height[now];

  $("sea-now").innerHTML = `<div class="now-big"></div><div class="now-desc"><strong></strong><span></span></div>`;
  $("sea-now").querySelector(".now-big").textContent = `🌊 ${m1(wave)} m`;
  $("sea-now").querySelector("strong").textContent = `${seaState(wave)} sea`;
  $("sea-now").querySelector("span").textContent =
    `Waves ${m1(wave)} m ${from(c.wave_direction ?? h.wave_direction[now])}, every ${Math.round(c.wave_period ?? h.wave_period[now]) || "–"} s · ` +
    `Swell ${m1(c.swell_wave_height ?? h.swell_wave_height[now])} m` +
    (typeof c.sea_surface_temperature === "number" ? ` · Sea ${m1(c.sea_surface_temperature)}°C` : "");

  const tides = findTides(h.time, h.sea_level_height_msl);
  const today = h.time[now].slice(0, 10);
  const nowLocal = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 16);
  // Today's tides (passed ones greyed) and the ones after.
  const upcoming = tides.filter((t) => t.time >= nowLocal || t.time.slice(0, 10) === today);
  const byDay = new Map();
  for (const t of upcoming) {
    const day = t.time.slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(t);
  }
  $("sea-tides").replaceChildren(
    ...[...byDay].map(([day, list]) => {
      const li = document.createElement("li");
      const d = new Date(`${day}T00:00`);
      li.innerHTML = `<b></b><span class="tide-times"></span>`;
      li.querySelector("b").textContent = day === today ? "Today" : `${DAYS[d.getDay()]} ${d.getDate()}`;
      li.querySelector(".tide-times").replaceChildren(
        ...list.map((t) => {
          const s = document.createElement("span");
          s.className = t.high ? "tide high" : "tide low";
          if (t.time < nowLocal) s.classList.add("past");
          s.textContent = `${t.high ? "▲ High" : "▼ Low"} ${t.time.slice(11, 16)} · ${m2(t.height)} m`;
          return s;
        })
      );
      return li;
    })
  );

  const ticks = [];
  h.time.forEach((t, i) => {
    const hr = Number(t.slice(11, 13));
    if (hr === 0) ticks.push({ at: i, label: DAYS[new Date(`${t.slice(0, 10)}T00:00`).getDay()] });
    else if (hr === 12) ticks.push({ at: i, label: "12" });
  });
  const levels = h.sea_level_height_msl.filter((v) => typeof v === "number");
  // Axis in steps of 0.1 m or more: a top that is a multiple of 0.4 m.
  const lo = Math.min(0, Math.floor(Math.min(...levels) / 0.4) * 0.4);
  const hi = Math.max(lo + 0.4, Math.ceil(Math.max(...levels) / 0.4) * 0.4);
  drawLines(
    $("sea-chart"),
    $("sea-readout"),
    {
      count: h.time.length,
      series: [{ values: h.sea_level_height_msl, cls: "tide-line" }],
      ticks,
      marks: tides.map((t) => ({ at: t.index, value: t.height, cls: t.high ? "high" : "low" })),
      points: h.time.map((t, i) => ({
        at: i,
        text: `${DAYS[new Date(`${t.slice(0, 10)}T00:00`).getDay()]} ${t.slice(11, 16)}: sea level ${m2(h.sea_level_height_msl[i])} m · waves ${m1(h.wave_height[i])} m (${seaState(h.wave_height[i]).toLowerCase()})`,
      })),
    },
    "Tap the chart for the sea level and waves at that hour.",
    { unit: "m", min: lo, max: hi, now }
  );

  const days = data.daily?.time || [];
  $("sea-days").replaceChildren(
    ...days.map((t, i) => {
      const li = document.createElement("li");
      const d = new Date(`${t}T00:00`);
      const max = data.daily.wave_height_max[i];
      li.textContent = `${i === 0 ? "Today" : `${DAYS[d.getDay()]} ${d.getDate()}`}: waves up to ${m1(max)} m · ${seaState(max)}`;
      return li;
    })
  );
}

function loadSaved() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVED_KEY));
    return s && s.at && s.data ? s : null;
  } catch {
    return null;
  }
}

async function refresh() {
  say("Loading the sea forecast…");
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch(URL_SEA, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.reason || `HTTP ${res.status}`);
    render(data);
    loadedAt = Date.now();
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify({ at: loadedAt, data }));
    } catch {}
    say(`Updated ${new Date().toLocaleTimeString()}`);
  } catch (e) {
    const saved = loadSaved();
    if (saved) {
      render(saved.data);
      say(`Couldn't load a new sea forecast. Showing the one saved at ${when(saved.at)}.`, true);
    } else {
      say(`Couldn't load the sea forecast (${e.message}). Try Refresh.`, true);
    }
  }
}

export function initSea() {
  $("sea-refresh").addEventListener("click", refresh);
}

export function showSea() {
  if (Date.now() - loadedAt > TTL) refresh();
}
