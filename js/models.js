// Model charts (#models): rain and wind over Tamil Nadu from six global
// weather models, side by side, from Open-Meteo (free, no key, CORS).
//
// One request reads every model's rain, wind and temperature on a 0.25° grid
// over Tamil Nadu (8–13.75° N, 76–80.5° E; the 295 points within about 40 km
// of the state, which keeps the request inside Open-Meteo's free limit of 600
// a minute), every 3 hours for 6 days, in UTC so the 3-hour
// steps end at 2:30, 5:30, 8:30… IST and a "24-hour rain" day is IMD's own,
// 8:30 AM to 8:30 AM. Each step's rain is the rain in the 3 hours to it; wind
// is the 10 m wind, and temperature the 2 m air, at that time. Between grid points values are blended from
// the four around (bilinear). The answer is kept for an hour (the models run
// every 6 to 12 hours), in IndexedDB, so the screen opens offline too: with no
// signal it shows the last run read, labelled with when it was read and how old
// it is. A "model agreement" line says how closely the six models agree on the
// rain at the chosen place (js/agree.js).
//
// These are the raw models, not IMD's forecast, and the screen says so.
import { loadLeaflet, addTiles } from "./stationmap.js";
import { districtRaster, BOX as RBOX, STEP as RSTEP, CW as RCW, CH as RCH } from "./rainmap.js";
import { TN_DISTRICTS } from "./districts.js";
import { homeDistrict, toWind, windUnit, toTemp, tempUnit } from "./prefs.js";
import { el, niceMax } from "./chart.js";
import { idbGet, idbPut } from "./idb.js";
import { makeZoomable } from "./zoom.js";
import { agreement } from "./agree.js";

const API = "https://api.open-meteo.com/v1/forecast";
export const MODELS = [
  { id: "ecmwf_ifs025", name: "ECMWF", long: "ECMWF IFS (Europe)", colour: "#e91e63", meta: "ecmwf_ifs025" },
  { id: "ecmwf_aifs025_single", name: "ECMWF AI", long: "ECMWF AIFS, the AI model", colour: "#00acc1", meta: "ecmwf_aifs025_single" },
  { id: "gfs_seamless", name: "GFS", long: "NOAA GFS (USA)", colour: "#1e88e5", meta: "ncep_gfs025" },
  { id: "icon_seamless", name: "ICON", long: "DWD ICON (Germany)", colour: "#43a047", meta: "dwd_icon" },
  { id: "ukmo_global_deterministic_10km", name: "UK Met Office", long: "UK Met Office global (10 km)", colour: "#8e24aa", meta: "ukmo_global_deterministic_10km" },
  { id: "gem_seamless", name: "GEM", long: "ECCC GEM (Canada)", colour: "#fb8c00", meta: null },
];

// The grid.
const LAT0 = 8;
const LON0 = 76;
const G = 0.25;
const NY = 24; // 8 … 13.75
const NX = 19; // 76 … 80.5
const N = NX * NY;
// The points read: within about 40 km of Tamil Nadu (north row first).
const MASK = [
  "0000000000000001111",
  "0000000000000111111",
  "0000000110111111111",
  "0000001111111111111",
  "0000011111111111111",
  "0000011111111111111",
  "0000011111111111110",
  "0111111111111111110",
  "1111111111111111100",
  "1111111111111111100",
  "1111111111111111100",
  "0111111111111111110",
  "0011111111111111110",
  "0011111111111111110",
  "0011111111111111110",
  "0001111111111111100",
  "0000111111111110000",
  "0000111111111110000",
  "0000111111111111000",
  "0001111111111111000",
  "0000111111100000000",
  "0000111111100000000",
  "0001111111000000000",
  "0000111110000000000",
];
const POINTS = [];
for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) if (MASK[NY - 1 - y][x] === "1") POINTS.push(y * NX + x);
const LAT1 = LAT0 + G * (NY - 1);
const LON1 = LON0 + G * (NX - 1);
const DAYS = 6;
const FRESH_MS = 60 * 60 * 1000;
const STEP_MS = 3 * 3600 * 1000;
const CACHE_KEY = "models.grid.v2";
const PREF = "myweather.models.";

// Colour bands: [from, colour, label].
const RAIN24 = [
  [0.5, "#c6e6ff", "0.5"],
  [2.5, "#7cc4ff", "2.5"],
  [7.5, "#2b8cff", "7.5"],
  [15, "#1b5fd1", "15"],
  [35, "#3a2fb8", "35"],
  [65, "#7d1fb0", "65"],
  [115, "#c2185b", "115"],
  [205, "#ff6d00", "205+ mm"],
];
const RAIN3 = [
  [0.5, "#c6e6ff", "0.5"],
  [1, "#7cc4ff", "1"],
  [2.5, "#2b8cff", "2.5"],
  [5, "#1b5fd1", "5"],
  [10, "#3a2fb8", "10"],
  [20, "#7d1fb0", "20"],
  [35, "#c2185b", "35"],
  [65, "#ff6d00", "65+ mm"],
];
const WIND = [
  [10, "#dcefd2", 10],
  [20, "#a5d98d", 20],
  [30, "#ffe082", 30],
  [40, "#ffb74d", 40],
  [50, "#ff7043", 50],
  [62, "#e53935", 62],
  [88, "#ad1457", 88],
  [118, "#4a148c", 118],
];
const TEMP = [
  [16, "#3f51b5", 16],
  [20, "#1e88e5", 20],
  [22, "#4fc3f7", 22],
  [24, "#80deea", 24],
  [26, "#a5d6a7", 26],
  [28, "#fff176", 28],
  [30, "#ffd54f", 30],
  [32, "#ffb74d", 32],
  [34, "#ff8a65", 34],
  [36, "#f4511e", 36],
  [38, "#d32f2f", 38],
  [40, "#880e4f", 40],
];
const LAYERS = {
  rain24: { name: "24-hour rain", bands: RAIN24, unit: "mm" },
  rain3: { name: "Rain every 3 hours", bands: RAIN3, unit: "mm" },
  wind: { name: "Wind speed", bands: WIND, unit: "km/h" },
  temp: { name: "Temperature", bands: TEMP, unit: "°C" },
};
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const RGB = new Map(Object.values(LAYERS).map((l) => [l.bands, l.bands.map(([, c]) => hexRgb(c))]));

const $ = (id) => document.getElementById(id);
const r1 = (v) => (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10);
const fmtMm = (v) => (Number.isFinite(v) ? `${r1(v)} mm` : "–");
const fmtWind = (v) => (Number.isFinite(v) ? `${Math.round(toWind(v))} ${windUnit()}` : "–");
const fmtTemp = (v) => (Number.isFinite(v) ? `${Math.round(toTemp(v))}${tempUnit()}` : "–");
const fmtVal = (layer, v) => (layer === "wind" ? fmtWind(v) : layer === "temp" ? fmtTemp(v) : fmtMm(v));

// ---- Times (IST) ----

const IST = { timeZone: "Asia/Kolkata" };
const istTime = (ms) =>
  new Date(ms).toLocaleTimeString("en-IN", { ...IST, hour: "numeric", minute: "2-digit", hour12: true }).replace(/\s?([ap])m/i, " $1m").toLowerCase();
const istDay = (ms) => new Date(ms).toLocaleDateString("en-IN", { ...IST, weekday: "short", day: "numeric", month: "short" });
const istWeekday = (ms) => new Date(ms).toLocaleDateString("en-IN", { ...IST, weekday: "short" });
const istHour = (ms) => Number(new Date(ms).toLocaleString("en-GB", { ...IST, hour: "2-digit", hour12: false }));
const stamp = (ms) => `${istWeekday(ms)} ${istTime(ms)}`;

// ---- Data ----

function gridUrl() {
  const lats = POINTS.map((i) => +(LAT0 + Math.floor(i / NX) * G).toFixed(2));
  const lons = POINTS.map((i) => +(LON0 + (i % NX) * G).toFixed(2));
  const q = new URLSearchParams({
    latitude: lats.join(","),
    longitude: lons.join(","),
    hourly: "precipitation,wind_speed_10m,temperature_2m",
    models: MODELS.map((m) => m.id).join(","),
    forecast_days: String(DAYS),
    temporal_resolution: "hourly_3",
    timezone: "GMT",
  });
  return `${API}?${q}`;
}

async function getJson(url, ms = 60000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (res.status === 429) throw new Error("limit");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    if (j?.error) throw new Error(/limit/i.test(j.reason) ? "limit" : j.reason);
    return j;
  } finally {
    clearTimeout(timer);
  }
}

/** The grid answer as { at, times (ms), models: { id: { rain, wind, temp } } }; arrays are [step * N + point] (NaN where not read). */
export function parseGrid(list, at = Date.now()) {
  if (!Array.isArray(list) || list.length !== POINTS.length) throw new Error("unexpected answer");
  const times = list[0].hourly.time.map((t) => Date.parse(`${t}Z`));
  const T = times.length;
  const models = {};
  for (const m of MODELS) {
    const rain = new Float32Array(T * N).fill(NaN);
    const wind = new Float32Array(T * N).fill(NaN);
    const temp = new Float32Array(T * N).fill(NaN);
    let any = false;
    list.forEach((p, k) => {
      const i = POINTS[k];
      const pr = p.hourly[`precipitation_${m.id}`] || [];
      const ws = p.hourly[`wind_speed_10m_${m.id}`] || [];
      const tt = p.hourly[`temperature_2m_${m.id}`] || [];
      for (let t = 0; t < T; t++) {
        if (typeof pr[t] === "number") {
          rain[t * N + i] = pr[t];
          any = true;
        }
        if (typeof ws[t] === "number") wind[t * N + i] = ws[t];
        if (typeof tt[t] === "number") temp[t * N + i] = tt[t];
      }
    });
    if (any) models[m.id] = { rain, wind, temp };
  }
  return { at, times, models, runs: {} };
}

// When each model's run started (UTC seconds), from Open-Meteo's model
// pages; missing ones are just not shown.
async function readRuns() {
  const runs = {};
  await Promise.all(
    MODELS.filter((m) => m.meta).map(async (m) => {
      try {
        const j = await getJson(`https://api.open-meteo.com/data/${m.meta}/static/meta.json`, 15000);
        if (j.last_run_initialisation_time) runs[m.id] = j.last_run_initialisation_time * 1000;
      } catch {}
    })
  );
  return runs;
}

let data = null;
async function loadData(force) {
  if (!data) {
    const saved = await idbGet("misc", CACHE_KEY);
    if (saved?.times?.length && saved.models) data = saved;
  }
  if (data && !force && Date.now() - data.at < FRESH_MS) return { data, fresh: true };
  if (navigator.onLine === false) {
    if (data) return { data, fresh: false };
    throw new Error("offline");
  }
  const [list, runs] = await Promise.all([getJson(gridUrl()), readRuns()]);
  const d = parseGrid(list);
  d.runs = runs;
  data = d;
  idbPut("misc", CACHE_KEY, d);
  return { data, fresh: true };
}

// ---- Values ----

// Bilinear value of a per-point field at a place (NaN where none).
export function sampleField(f, lat, lon) {
  const fy = Math.min(NY - 1, Math.max(0, (lat - LAT0) / G));
  const fx = Math.min(NX - 1, Math.max(0, (lon - LON0) / G));
  const y0 = Math.min(NY - 2, Math.floor(fy));
  const x0 = Math.min(NX - 2, Math.floor(fx));
  const dy = fy - y0;
  const dx = fx - x0;
  let w = 0;
  let v = 0;
  const add = (y, x, wt) => {
    const a = f[y * NX + x];
    if (wt > 0 && Number.isFinite(a)) {
      w += wt;
      v += a * wt;
    }
  };
  add(y0, x0, (1 - dy) * (1 - dx));
  add(y0, x0 + 1, (1 - dy) * dx);
  add(y0 + 1, x0, dy * (1 - dx));
  add(y0 + 1, x0 + 1, dy * dx);
  return w > 0.25 ? v / w : NaN;
}

// The 24-hour windows: the next 24 hours, then IMD's rain days (to 8:30 AM
// IST = 03:00 UTC) that the data covers in full.
function windows(times, now = Date.now()) {
  const out = [];
  const first = times.findIndex((t) => t > now);
  if (first >= 0 && first + 8 <= times.length) out.push({ key: "next", from: first, to: first + 8, label: "Next 24 hours", end: times[first + 7] });
  times.forEach((t, k) => {
    if (new Date(t).getUTCHours() !== 3 || k < 8) return;
    const start = times[k - 8];
    out.push({ key: String(t), from: k - 7, to: k + 1, end: t, label: `${istDay(start)} 8:30 am → ${istWeekday(t)} 8:30 am`, day: istDay(start), short: istWeekday(start) });
  });
  return out;
}

// One model's field for the shown choice.
function fieldOf(m, sel) {
  const md = data?.models[m.id];
  if (!md) return null;
  const f = new Float32Array(N).fill(NaN);
  if (sel.layer === "rain24") {
    const w = sel.window;
    if (!w) return null;
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (let t = w.from; t < w.to; t++) s += md.rain[t * N + i];
      f[i] = s; // NaN when a step is missing
    }
  } else {
    const arr = md[sel.layer === "rain3" ? "rain" : sel.layer];
    for (let i = 0; i < N; i++) f[i] = arr[sel.step * N + i];
  }
  return f.some(Number.isFinite) ? f : null;
}

function bandIndex(bands, v) {
  if (!(v >= bands[0][0])) return -1;
  let k = 0;
  while (k + 1 < bands.length && v >= bands[k + 1][0]) k++;
  return k;
}

function nearestDistrict(lat, lon) {
  let best = null;
  let bd = Infinity;
  for (const [name, la, lo] of TN_DISTRICTS) {
    const d = (la - lat) ** 2 + ((lo - lon) * Math.cos((lat * Math.PI) / 180)) ** 2;
    if (d < bd) {
      bd = d;
      best = name;
    }
  }
  return best;
}

// ---- Side by side: one small map per model ----

const PW = 330;
const PH = Math.round((PW * (LAT1 - LAT0)) / ((LON1 - LON0) * Math.cos((10.9 * Math.PI) / 180)));
let pixels = null; // { fy, fx, id, edge } per panel pixel

function districtAt(raster, lat, lon) {
  if (!raster) return 1; // no outlines: treat all as inside
  const x = Math.floor((lon - RBOX.lon0) / RSTEP);
  const y = Math.floor((RBOX.lat1 - lat) / RSTEP);
  return x < 0 || y < 0 || x >= RCW || y >= RCH ? 0 : raster[y * RCW + x];
}

function panelPixels(raster) {
  const n = PW * PH;
  const id = new Uint8Array(n);
  const lat = new Float32Array(n);
  const lon = new Float32Array(n);
  for (let py = 0; py < PH; py++)
    for (let px = 0; px < PW; px++) {
      const k = py * PW + px;
      lon[k] = LON0 + ((px + 0.5) / PW) * (LON1 - LON0);
      lat[k] = LAT1 - ((py + 0.5) / PH) * (LAT1 - LAT0);
      id[k] = districtAt(raster, lat[k], lon[k]);
    }
  // 1 = district line, 2 = Tamil Nadu's edge.
  const edge = new Uint8Array(n);
  if (raster)
    for (let py = 0; py < PH - 1; py++)
      for (let px = 0; px < PW - 1; px++) {
        const k = py * PW + px;
        const a = id[k];
        const b = id[k + 1];
        const c = id[k + PW];
        if (a !== b || a !== c) edge[k] = !a || !b || !c ? 2 : 1;
      }
  return { id, lat, lon, edge, outlines: !!raster };
}

const CITIES = [
  ["Chennai", 13.08, 80.27],
  ["Madurai", 9.93, 78.12],
  ["Coimbatore", 11.0, 76.96],
  ["Tiruchirappalli", 10.8, 78.69],
  ["Salem", 11.66, 78.15],
  ["Tirunelveli", 8.71, 77.76],
  ["Puducherry", 11.93, 79.83],
];

function dark() {
  return getComputedStyle(document.documentElement).colorScheme === "dark";
}

function drawPanel(canvas, f, bands) {
  canvas.width = PW;
  canvas.height = PH;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(PW, PH);
  const D = dark();
  const inBg = D ? [40, 47, 56] : [255, 255, 255];
  const outBg = D ? [24, 29, 35] : [226, 231, 237];
  const line = D ? [150, 160, 172] : [120, 130, 142];
  const edgeC = D ? [230, 234, 238] : [40, 46, 54];
  const rgb = RGB.get(bands);
  let top = null;
  for (let k = 0; k < PW * PH; k++) {
    const inside = pixels.id[k] > 0;
    const v = f ? sampleField(f, pixels.lat[k], pixels.lon[k]) : NaN;
    let c = inside ? inBg : outBg;
    const b = bandIndex(bands, v);
    if (b >= 0) {
      const a = inside ? 1 : 0.6;
      c = c.map((x, j) => x * (1 - a) + rgb[b][j] * a);
    }
    if (inside && Number.isFinite(v) && (!top || v > top.v)) top = { v, lat: pixels.lat[k], lon: pixels.lon[k] };
    if (pixels.edge[k] === 2) c = edgeC;
    else if (pixels.edge[k] === 1) c = c.map((x, j) => x * 0.55 + line[j] * 0.45);
    const o = k * 4;
    img.data[o] = c[0];
    img.data[o + 1] = c[1];
    img.data[o + 2] = c[2];
    img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // Cities.
  ctx.font = "600 11px system-ui, sans-serif";
  for (const [name, la, lo] of CITIES) {
    const x = ((lo - LON0) / (LON1 - LON0)) * PW;
    const y = ((LAT1 - la) / (LAT1 - LAT0)) * PH;
    ctx.beginPath();
    ctx.arc(x, y, 2.6, 0, Math.PI * 2);
    ctx.fillStyle = D ? "#fff" : "#000";
    ctx.fill();
    if (name === "Chennai" || name === "Madurai" || name === "Coimbatore") {
      ctx.lineWidth = 3;
      ctx.strokeStyle = D ? "rgba(0,0,0,.7)" : "rgba(255,255,255,.85)";
      const tx = name === "Chennai" ? x - 4 : x + 4;
      ctx.textAlign = name === "Chennai" ? "right" : "left";
      ctx.strokeText(name, tx, y + 4);
      ctx.fillText(name, tx, y + 4);
    }
  }
  return top;
}

// ---- Screen state ----

const sel = { layer: "rain24", window: null, step: 0, model: MODELS[0].id };
let wins = [];
let place = null; // { name, lat, lon }
let L = null;
let map = null;
let overlay = null;
let overlayUrl = "";
let spotMarker = null;
let run = 0;
let stale = false; // showing a saved run that couldn't be refreshed

const ago = (ms) => {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 90) return `${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} hours` : `${Math.round(h / 24)} days`;
};
const readAt = () => `${istDay(data.at)}, ${istTime(data.at)}`;

// The yellow line that says the maps and charts are from a saved run.
function paintNet() {
  const line = $("md-net");
  const off = navigator.onLine === false;
  line.hidden = !(data && (off || stale));
  if (line.hidden) return;
  const over = data.times.length && data.times[data.times.length - 1] < Date.now();
  line.textContent = `${off ? "No connection. " : "Couldn't update. "}Showing the last run read on ${readAt()} (${ago(Date.now() - data.at)} ago).${
    over ? " It is out of date: every time in it has passed." : " Times that have passed are still in it."
  } It updates when you're back online.`;
}
const savedTag = () => (data && (stale || navigator.onLine === false) ? ` · saved run, read ${readAt()}` : "");

function say(text, error = false) {
  const s = $("md-status");
  s.textContent = text;
  s.className = error ? "status error" : "status";
}

const pref = (k, d) => {
  try {
    return localStorage.getItem(PREF + k) ?? d;
  } catch {
    return d;
  }
};
const setPref = (k, v) => {
  try {
    localStorage.setItem(PREF + k, v);
  } catch {}
};

function selLabel() {
  if (sel.layer === "rain24") {
    const w = sel.window;
    if (!w) return "24-hour rain";
    return w.key === "next" ? `24-hour rain to ${istDay(w.end)}, ${istTime(w.end)}` : `24-hour rain, ${w.label}`;
  }
  const t = data.times[sel.step];
  if (sel.layer === "temp") return `Temperature at ${istDay(t)}, ${istTime(t)}`;
  return sel.layer === "wind" ? `Wind speed at ${istDay(t)}, ${istTime(t)}` : `Rain in the 3 hours to ${istDay(t)}, ${istTime(t)}`;
}

function legend(target) {
  const l = LAYERS[sel.layer];
  target.replaceChildren(
    ...l.bands.map(([, c, label], i) => {
      const s = document.createElement("span");
      s.style.setProperty("--level", c);
      const last = i === l.bands.length - 1;
      s.textContent =
        sel.layer === "wind"
          ? `${Math.round(toWind(label))}${last ? `+ ${windUnit()}` : ""}`
          : sel.layer === "temp"
            ? `${Math.round(toTemp(label))}${last ? `+ ${tempUnit()}` : ""}`
            : label;
      return s;
    })
  );
}

function renderPanels() {
  const grid = $("md-grid");
  const l = LAYERS[sel.layer];
  $("md-title").textContent = selLabel() + savedTag();
  grid.replaceChildren(
    ...MODELS.map((m) => {
      const fig = document.createElement("figure");
      fig.className = "md-panel";
      fig.dataset.model = m.id;
      fig.classList.toggle("on", m.id === sel.model);
      const cap = document.createElement("figcaption");
      cap.innerHTML = '<strong></strong><small></small>';
      cap.querySelector("strong").textContent = m.name;
      cap.querySelector("strong").style.setProperty("--model", m.colour);
      const canvas = document.createElement("canvas");
      canvas.setAttribute("role", "img");
      fig.append(cap, canvas);
      const f = fieldOf(m, sel);
      const top = drawPanel(canvas, f, l.bands);
      let line;
      if (!f) line = "Not available for this time";
      else if (sel.layer === "temp") line = top ? `Hottest ${fmtTemp(top.v)} near ${nearestDistrict(top.lat, top.lon)}` : "Not available";
      else if (!top || !(top.v >= l.bands[0][0])) line = sel.layer === "wind" ? "Calm" : "Dry";
      else line = `${sel.layer === "wind" ? "Strongest" : "Most"} ${fmtVal(sel.layer, top.v)} near ${nearestDistrict(top.lat, top.lon)}`;
      cap.querySelector("small").textContent = line;
      canvas.setAttribute("aria-label", `${m.name}: ${line}`);
      return fig;
    })
  );
  legend($("md-legend"));
  const runs = MODELS.filter((m) => data.runs?.[m.id]).map(
    (m) => `${m.name} ${new Date(data.runs[m.id]).toLocaleString("en-GB", { timeZone: "UTC", hour: "2-digit", day: "numeric", month: "short" })} UTC`
  );
  $("md-runs").textContent = runs.length ? `Model runs: ${runs.join(" · ")}. Read ${istDay(data.at)}, ${istTime(data.at)}.` : `Read ${istDay(data.at)}, ${istTime(data.at)}.`;
}

// ---- The big map ----

function ensureMap() {
  if (map) return;
  const box = $("md-map");
  map = L.map(box, { zoomControl: true }).setView([10.9, 78.4], 6);
  addTiles(L, map, box);
  map.on("click", (e) => popupAt(e.latlng.lat, e.latlng.lng, e.latlng));
}

function popupAt(lat, lon, latlng) {
  if (!data) return;
  const div = document.createElement("div");
  div.className = "md-pop";
  const head = document.createElement("strong");
  head.textContent = `Near ${nearestDistrict(lat, lon)}`;
  const sub = document.createElement("small");
  sub.textContent = selLabel();
  const ul = document.createElement("ul");
  for (const m of MODELS) {
    const f = fieldOf(m, sel);
    const li = document.createElement("li");
    li.innerHTML = '<i></i><span></span><b></b>';
    li.querySelector("i").style.background = m.colour;
    li.querySelector("span").textContent = m.name;
    li.querySelector("b").textContent = f ? fmtVal(sel.layer, sampleField(f, lat, lon)) : "n/a";
    ul.append(li);
  }
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "secondary small";
  btn.textContent = "Charts for this spot";
  btn.addEventListener("click", () => {
    map.closePopup();
    setPlace({ name: `Map spot near ${nearestDistrict(lat, lon)}`, lat, lon, spot: true });
    $("md-place-head").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  div.append(head, sub, ul, btn);
  L.popup().setLatLng(latlng).setContent(div).openOn(map);
}

// Mercator rows, so the picture lines up with the map tiles.
const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const unmerc = (y) => (360 / Math.PI) * Math.atan(Math.exp(y)) - 90;

async function renderOverlay() {
  if (!map) return;
  const m = MODELS.find((x) => x.id === sel.model) || MODELS[0];
  const f = fieldOf(m, sel);
  const l = LAYERS[sel.layer];
  const top = LAT1 + G / 2;
  const bottom = LAT0 - G / 2;
  const left = LON0 - G / 2;
  const right = LON1 + G / 2;
  const W = Math.round((right - left) / 0.02);
  const H = Math.round((top - bottom) / 0.02);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(W, H);
  const rgb = RGB.get(l.bands);
  const mt = merc(top);
  const mb = merc(bottom);
  if (f)
    for (let j = 0; j < H; j++) {
      const lat = unmerc(mt + ((mb - mt) * (j + 0.5)) / H);
      for (let x = 0; x < W; x++) {
        const lon = left + ((x + 0.5) / W) * (right - left);
        const b = bandIndex(l.bands, sampleField(f, lat, lon));
        if (b < 0) continue;
        const o = (j * W + x) * 4;
        [img.data[o], img.data[o + 1], img.data[o + 2]] = rgb[b];
        img.data[o + 3] = 255;
      }
    }
  ctx.putImageData(img, 0, 0);
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  const url = URL.createObjectURL(blob);
  const bounds = [
    [bottom, left],
    [top, right],
  ];
  if (!overlay) overlay = L.imageOverlay(url, bounds, { opacity: 0.7, interactive: false, className: "rr-layer" }).addTo(map);
  else overlay.setUrl(url);
  if (overlayUrl) URL.revokeObjectURL(overlayUrl);
  overlayUrl = url;
  $("md-map-title").textContent = `${m.long}: ${selLabel()}${f ? "" : " (not available)"}${savedTag()}`;
  legend($("md-legend2"));
  for (const b of $("md-models").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.model === sel.model));
}

// ---- Charts for a place ----

function placeSeries(kind) {
  const out = [];
  for (const m of MODELS) {
    const md = data.models[m.id];
    if (!md) continue;
    const arr = md[kind];
    const vals = data.times.map((_, t) => sampleField(arr.subarray(t * N, (t + 1) * N), place.lat, place.lon));
    out.push({ m, vals });
  }
  return out;
}

const CW_ = 360;
const CH_ = 200;
const CL = 34;
const CR = 8;
const CT = 22;
const CB = 24;

function lineChart(svg, readout, kind) {
  const series = placeSeries(kind);
  const now = Date.now();
  const k0 = Math.max(0, data.times.findIndex((t) => t > now));
  const idx = data.times.map((_, k) => k).filter((k) => k >= k0);
  const conv = kind === "wind" ? toWind : kind === "temp" ? toTemp : (v) => v;
  const all = series.flatMap((s) => idx.map((k) => conv(s.vals[k])).filter(Number.isFinite));
  let min = 0;
  let max;
  if (kind === "temp") {
    // A range around the values, in steps of 2 or 5 degrees.
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    const unit = hi - lo > 12 ? 5 : 2;
    min = Math.floor((all.length ? lo : 20) / unit) * unit;
    max = Math.max(min + 4 * unit, Math.ceil((all.length ? hi : 30) / unit) * unit);
    max = min + Math.ceil((max - min) / 4 / unit) * 4 * unit;
  } else max = niceMax(Math.max(kind === "wind" ? 10 : 2, ...all));
  const x = (i) => CL + ((CW_ - CL - CR) * i) / Math.max(1, idx.length - 1);
  const y = (v) => CT + (CH_ - CT - CB) * (1 - (Math.min(v, max) - min) / (max - min));
  svg.setAttribute("viewBox", `0 0 ${CW_} ${CH_}`);
  svg.replaceChildren();
  for (let i = 0; i <= 4; i++) {
    const v = min + ((max - min) / 4) * i;
    svg.append(el("line", { x1: CL, x2: CW_ - CR, y1: y(v), y2: y(v), class: "grid" }));
    svg.append(el("text", { x: CL - 4, y: y(v) + 3, class: "axis", "text-anchor": "end" }, String(+v.toFixed(1))));
  }
  svg.append(el("text", { x: 2, y: 9, class: "axis" }, kind === "wind" ? windUnit() : kind === "temp" ? tempUnit() : "mm / 3 h"));
  // Days: a line near midnight (11:30 pm step) and the name under midday.
  idx.forEach((k, i) => {
    const h = istHour(data.times[k]);
    if (h === 23) svg.append(el("line", { x1: x(i), x2: x(i), y1: CT, y2: CH_ - CB, class: "grid" }));
    if (h === 11) svg.append(el("text", { x: x(i), y: CH_ - 8, class: "axis", "text-anchor": "middle" }, istWeekday(data.times[k])));
  });
  for (const s of series) {
    let d = "";
    let pen = false;
    idx.forEach((k, i) => {
      const v = conv(s.vals[k]);
      if (!Number.isFinite(v)) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    if (d) svg.append(el("path", { d, class: "md-line", stroke: s.m.colour, fill: "none", "stroke-width": "1.8" }));
  }
  const cursor = el("line", { x1: 0, x2: 0, y1: CT, y2: CH_ - CB, class: "md-cursor", visibility: "hidden" });
  svg.append(cursor);
  const step = (CW_ - CL - CR) / Math.max(1, idx.length - 1);
  idx.forEach((k, i) => {
    const r = el("rect", { x: x(i) - step / 2, y: CT, width: step, height: CH_ - CT - CB, class: "hit" });
    const show = () => {
      cursor.setAttribute("x1", x(i));
      cursor.setAttribute("x2", x(i));
      cursor.setAttribute("visibility", "visible");
      const t = data.times[k];
      const vals = series.map((s) => `${s.m.name} ${fmtVal(kind, s.vals[k])}`).join(" · ");
      readout.textContent = kind === "rain" ? `3 h to ${stamp(t)}: ${vals}` : `${stamp(t)}: ${vals}`;
    };
    r.addEventListener("click", show);
    svg.append(r);
  });
  if (!series.length) readout.textContent = "No model data for this place.";
  else readout.textContent = "Tap the chart for each model's figure.";
}

function dailyTotals() {
  const days = wins.filter((w) => w.key !== "next");
  const rows = MODELS.map((m) => {
    const md = data.models[m.id];
    const vals = days.map((w) => {
      if (!md) return NaN;
      let s = 0;
      for (let t = w.from; t < w.to; t++) s += sampleField(md.rain.subarray(t * N, (t + 1) * N), place.lat, place.lon);
      return s;
    });
    return { m, vals };
  });
  return { days, rows };
}

function barChart(svg, readout) {
  const { days, rows } = dailyTotals();
  const max = niceMax(Math.max(5, ...rows.flatMap((r) => r.vals.filter(Number.isFinite))));
  const y = (v) => CT + (CH_ - CT - CB) * (1 - Math.min(v, max) / max);
  svg.setAttribute("viewBox", `0 0 ${CW_} ${CH_}`);
  svg.replaceChildren();
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    svg.append(el("line", { x1: CL, x2: CW_ - CR, y1: y(v), y2: y(v), class: "grid" }));
    svg.append(el("text", { x: CL - 4, y: y(v) + 3, class: "axis", "text-anchor": "end" }, String(+v.toFixed(1))));
  }
  svg.append(el("text", { x: 2, y: 9, class: "axis" }, "mm / day"));
  const gw = (CW_ - CL - CR) / Math.max(1, days.length);
  const bw = Math.max(3, Math.min(12, (gw - 10) / MODELS.length));
  days.forEach((w, d) => {
    const g = el("g", { class: "bar", tabindex: "0" });
    const gx = CL + gw * d;
    g.append(el("rect", { x: gx, y: CT, width: gw, height: CH_ - CT - CB, class: "hit" }));
    rows.forEach((r, i) => {
      const v = r.vals[d];
      const bx = gx + (gw - bw * MODELS.length) / 2 + i * bw;
      if (Number.isFinite(v) && v > 0) {
        const h = Math.max(1, y(0) - y(v));
        g.append(el("rect", { x: bx + 0.5, y: y(0) - h, width: bw - 1, height: h, fill: r.m.colour, rx: 1.5 }));
      } else if (!Number.isFinite(v)) {
        g.append(el("text", { x: bx + bw / 2, y: y(0) - 3, class: "axis", "text-anchor": "middle" }, "·"));
      }
    });
    g.append(el("text", { x: gx + gw / 2, y: CH_ - 8, class: "axis", "text-anchor": "middle" }, w.short));
    const show = () => {
      for (const s of svg.querySelectorAll(".bar.on")) s.classList.remove("on");
      g.classList.add("on");
      readout.textContent = `${w.label}: ${rows.map((r) => `${r.m.name} ${fmtMm(r.vals[d])}`).join(" · ")}`;
    };
    g.addEventListener("click", show);
    g.addEventListener("focus", show);
    svg.append(g);
  });
  readout.textContent = days.length ? "Tap a day for each model's figure." : "No full rain day in the data.";

  // The table under it, with the models' average.
  const table = $("md-table");
  const head = `<thead><tr><th>Model</th>${days.map((w) => `<th>${w.short}</th>`).join("")}</tr></thead>`;
  const avg = days.map((_, d) => {
    const v = rows.map((r) => r.vals[d]).filter(Number.isFinite);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
  });
  const cell = (v) => `<td>${Number.isFinite(v) ? r1(v) : "–"}</td>`;
  table.innerHTML =
    head +
    "<tbody>" +
    rows.map((r) => `<tr><th><i style="background:${r.m.colour}"></i>${r.m.name}</th>${r.vals.map(cell).join("")}</tr>`).join("") +
    `<tr class="total"><th>Average</th>${avg.map(cell).join("")}</tr></tbody>`;
  $("md-days-note").textContent = days.length
    ? `Rain days run 8:30 am to 8:30 am IST, as IMD's do: ${days[0].label} first. – means the model's run doesn't reach that far.`
    : "";
}

function renderAgreement() {
  const box = $("md-agree");
  const { days, rows } = dailyTotals();
  const now = Date.now();
  const coming = days.filter((w) => w.end > now);
  const use = (coming.length ? coming : days).slice(0, 3);
  const a = agreement(use.map((w) => ({ label: w.short, vals: rows.map((r) => r.vals[days.indexOf(w)]) })));
  box.className = "md-agree" + (a ? ` ${a.word.toLowerCase()}` : "");
  if (!a) {
    box.textContent = `Model agreement for ${place.name}: not enough models reach a full rain day.`;
    return;
  }
  const tip = a.word === "High" ? "The models tell the same story; trust the rain figures more." : a.word === "Moderate" ? "The models differ somewhat; take the rain as a guide." : "The models disagree; the rain could be much more or less than any one shows.";
  box.replaceChildren();
  const head = document.createElement("strong");
  head.textContent = `Model agreement for ${place.name}: ${a.word} (${a.score}%)`;
  const small = document.createElement("small");
  small.textContent = `${tip} Next ${a.days.length} rain day${a.days.length > 1 ? "s" : ""}: ${a.days.map((d) => `${d.label} ${d.score}%`).join(" · ")}.`;
  box.append(head, small);
}

function renderCharts() {
  if (!data || !place) return;
  renderAgreement();
  for (const id of ["md-place-name", "md-place-name2", "md-place-name3", "md-place-name4"]) $(id).textContent = place.name;
  lineChart($("md-rain-chart"), $("md-rain-readout"), "rain");
  lineChart($("md-wind-chart"), $("md-wind-readout"), "wind");
  lineChart($("md-temp-chart"), $("md-temp-readout"), "temp");
  barChart($("md-day-chart"), $("md-day-readout"));
  spotMarker?.remove();
  if (map && place.spot) spotMarker = L.circleMarker([place.lat, place.lon], { radius: 6, color: "#000", weight: 2, fillColor: "#fff", fillOpacity: 1 }).addTo(map);
}

function setPlace(p) {
  place = p;
  const s = $("md-place");
  let spot = s.querySelector('option[value="spot"]');
  if (p.spot) {
    if (!spot) {
      spot = document.createElement("option");
      spot.value = "spot";
      s.append(spot);
    }
    spot.textContent = p.name;
    s.value = "spot";
  } else {
    spot?.remove();
    s.value = p.name;
    setPref("place", p.name);
  }
  renderCharts();
}

// ---- Controls ----

function fillTimes() {
  wins = windows(data.times);
  const day = $("md-day");
  const was = sel.window?.key;
  day.replaceChildren(
    ...wins.map((w) => {
      const o = document.createElement("option");
      o.value = w.key;
      o.textContent = w.label;
      return o;
    })
  );
  sel.window = wins.find((w) => w.key === was) || wins[0] || null;
  if (sel.window) day.value = sel.window.key;
  const now = Date.now();
  const first = Math.max(0, data.times.findIndex((t) => t > now));
  const r = $("md-step");
  r.min = String(first);
  r.max = String(data.times.length - 1);
  if (!(sel.step >= first)) sel.step = first;
  r.value = String(sel.step);
}

function showLayer() {
  for (const b of document.querySelectorAll("#md-layers button")) b.setAttribute("aria-selected", String(b.dataset.layer === sel.layer));
  $("md-day-wrap").hidden = sel.layer !== "rain24";
  $("md-step-wrap").hidden = sel.layer === "rain24";
  if (data) $("md-when").textContent = stamp(data.times[sel.step]);
}

function redraw() {
  if (!data) return;
  showLayer();
  renderPanels();
  renderOverlay();
}

async function load(force = false) {
  const me = ++run;
  say(data ? "Updating the models…" : "Reading six weather models from Open-Meteo…");
  try {
    if (!pixels) {
      const raster = await districtRaster().catch(() => null);
      pixels = panelPixels(raster);
    }
    const got = await loadData(force);
    if (me !== run) return;
    stale = !got.fresh;
    paintNet();
    fillTimes();
    redraw();
    renderCharts();
    const have = MODELS.filter((m) => data.models[m.id]).length;
    say(`${have} of ${MODELS.length} models. Pinch or double-tap a chart to zoom; tap the map for each model's figure.`);
  } catch (e) {
    if (me !== run) return;
    stale = !!data;
    paintNet();
    if (data) {
      fillTimes();
      redraw();
      renderCharts();
    }
    const why =
      e.message === "offline"
        ? "No connection, and no run is saved yet. Open this screen once with a signal and the last run is kept for next time."
        : e.message === "limit"
        ? "Open-Meteo's free limit for this phone is used up for now; try again in a few minutes."
        : /Failed to fetch|NetworkError|Load failed|abort/i.test(e.message)
          ? "Couldn't reach Open-Meteo. Check the connection."
          : `Couldn't read the models (${e.message}).`;
    say(data ? `${why} Showing what was read ${readAt()}.` : why, true);
  }
}

export function initModels() {
  const l = pref("layer", "rain24");
  if (LAYERS[l]) sel.layer = l;
  const m = pref("model", MODELS[0].id);
  if (MODELS.some((x) => x.id === m)) sel.model = m;

  $("md-layers").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-layer]");
    if (!b) return;
    sel.layer = b.dataset.layer;
    setPref("layer", sel.layer);
    redraw();
  });
  $("md-day").addEventListener("change", () => {
    sel.window = wins.find((w) => w.key === $("md-day").value) || null;
    redraw();
  });
  const stepTo = (v) => {
    const r = $("md-step");
    sel.step = Math.min(Number(r.max), Math.max(Number(r.min), v));
    r.value = String(sel.step);
    redraw();
  };
  $("md-step").addEventListener("input", () => stepTo(Number($("md-step").value)));
  $("md-prev").addEventListener("click", () => stepTo(sel.step - 1));
  $("md-next").addEventListener("click", () => stepTo(sel.step + 1));
  $("md-refresh").addEventListener("click", () => load(true));
  window.addEventListener("offline", paintNet);
  window.addEventListener("online", () => {
    if ($("view-models").hidden) stale = true; // refreshed when the screen is next opened
    else load();
  });

  $("md-models").replaceChildren(
    ...MODELS.map((x) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "secondary small";
      b.dataset.model = x.id;
      b.style.setProperty("--model", x.colour);
      b.textContent = x.name;
      return b;
    })
  );
  const pickModel = (id) => {
    sel.model = id;
    setPref("model", id);
    for (const f of document.querySelectorAll(".md-panel")) f.classList.toggle("on", f.dataset.model === id);
    renderOverlay();
  };
  $("md-models").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-model]");
    if (b) pickModel(b.dataset.model);
  });
  $("md-grid").addEventListener("click", (e) => {
    const f = e.target.closest(".md-panel");
    if (f) pickModel(f.dataset.model);
  });

  const s = $("md-place");
  s.replaceChildren(
    ...TN_DISTRICTS.map(([n]) => {
      const o = document.createElement("option");
      o.value = o.textContent = n;
      return o;
    })
  );
  s.addEventListener("change", () => {
    const d = TN_DISTRICTS.find(([n]) => n === s.value);
    if (d) setPlace({ name: d[0], lat: d[1], lon: d[2] });
  });
  const want = pref("place", homeDistrict());
  const d = TN_DISTRICTS.find(([n]) => n === want) || TN_DISTRICTS.find(([n]) => n === "Chennai");
  // Chennai's district centre is inland; use the city itself.
  place = d[0] === "Chennai" ? { name: "Chennai", lat: 13.08, lon: 80.27 } : { name: d[0], lat: d[1], lon: d[2] };
  s.value = d[0];

  $("md-swatches").replaceChildren(
    ...MODELS.map((x) => {
      const sp = document.createElement("span");
      sp.style.setProperty("--level", x.colour);
      sp.textContent = x.name;
      return sp;
    })
  );
  for (const id of ["md-zoom", "md-rain-zoom", "md-wind-zoom", "md-temp-zoom", "md-day-zoom"]) makeZoomable($(id));
  showLayer();
}

export async function showModels() {
  try {
    L = await loadLeaflet();
    ensureMap();
    setTimeout(() => map.invalidateSize(), 0);
  } catch (e) {
    $("md-map").textContent = `Couldn't open the map (${e.message}).`;
  }
  if (data && !stale && Date.now() - data.at < FRESH_MS) return;
  load();
}

