// Wind & storms (#wind): moving wind over the Bay of Bengal, for when a
// depression or cyclone is near. The wind comes from Open-Meteo's forecast
// (ECMWF, GFS and others; api.open-meteo.com, no key) on a 1° grid from 5°N to
// 21°N and 78°E to 94°E, every 3 hours for 2 days, in one request. Particles
// drift with the wind on a Leaflet map and are coloured by IMD's cyclone
// categories; the lowest pressure on the map is marked. The last forecast is
// kept on the phone for when the network drops.
//
// #wind?page=windy shows Windy's own map (embed.windy.com) under the menu,
// for more layers (gusts, rain, pressure, satellite).
import { loadLeaflet, addTiles } from "./stationmap.js";
import { routeParams } from "./route.js";
import { when } from "./offline.js";
import { toWind, windUnit } from "./prefs.js";

const LAT0 = 5;
const LAT1 = 21;
const LON0 = 78;
const LON1 = 94;
const STEP = 1;
export const CHENNAI = { lat: 13.08, lon: 80.27 };
const SAVED_KEY = "myweather.wind.last";
const TTL = 30 * 60 * 1000;

const NLAT = (LAT1 - LAT0) / STEP + 1;
const NLON = (LON1 - LON0) / STEP + 1;

export function gridPoints() {
  const lats = [];
  const lons = [];
  for (let i = 0; i < NLAT; i++) for (let j = 0; j < NLON; j++) {
    lats.push(LAT0 + i * STEP);
    lons.push(LON0 + j * STEP);
  }
  lats.push(CHENNAI.lat);
  lons.push(CHENNAI.lon);
  return { lats, lons };
}

function forecastUrl() {
  const { lats, lons } = gridPoints();
  return (
    "https://api.open-meteo.com/v1/forecast?" +
    new URLSearchParams({
      latitude: lats.join(","),
      longitude: lons.join(","),
      hourly: "wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl",
      forecast_days: 2,
      temporal_resolution: "hourly_3",
      timezone: "Asia/Kolkata",
    })
  );
}

const WINDY_URL =
  "https://embed.windy.com/embed2.html?" +
  new URLSearchParams({
    lat: 13,
    lon: 85,
    detailLat: CHENNAI.lat,
    detailLon: CHENNAI.lon,
    zoom: 5,
    level: "surface",
    overlay: "wind",
    product: "ecmwf",
    menu: "",
    message: "true",
    marker: "true",
    calendar: "now",
    pressure: "true",
    type: "map",
    location: "coordinates",
    detail: "",
    metricWind: "km/h",
    metricTemp: "°C",
    radarRange: "-1",
  });

// IMD's classification of low-pressure systems by sustained wind (km/h).
export const BANDS = [
  [31, "#b3e5fc", "Under 31", "Low or less"],
  [50, "#4dd0e1", "31–49", "Depression"],
  [62, "#9ccc65", "50–61", "Deep depression"],
  [89, "#ffee58", "62–88", "Cyclonic storm"],
  [118, "#ffa726", "89–117", "Severe cyclonic storm"],
  [166, "#ef5350", "118–165", "Very severe"],
  [Infinity, "#e040fb", "166+", "Extremely severe or super"],
];
export const band = (kmh) => BANDS.find(([max]) => kmh < max);

const $ = (id) => document.getElementById(id);
const status = $("wind-status");
const box = $("wind-map");
const canvas = $("wind-canvas");
const slider = $("wind-time");
const timeLabel = $("wind-time-label");
const summary = $("wind-summary");
const home = $("wind-home");
const reader = $("wind-reader");
const frame = $("wind-frame");

let L = null;
let map = null;
let marks = null;
let data = null; // { times: [...], u, v, s, g, p: Float32Array[time][point], at }
let loadedAt = 0;
let field = null; // screen-space vectors for the current view and time
let particles = [];
let raf = 0;
let visible = false;

function say(text, error = false) {
  status.textContent = text;
  status.className = error ? "status error" : "status";
}

// ---- Data ----

// Open-Meteo answers with one object per location, in the order asked.
export function parseGrid(body) {
  const rows = Array.isArray(body) ? body : [body];
  const times = rows[0]?.hourly?.time || [];
  const n = rows.length;
  const make = () => times.map(() => new Float32Array(n));
  const u = make();
  const v = make();
  const s = make();
  const g = make();
  const p = make();
  rows.forEach((r, k) => {
    const h = r.hourly || {};
    times.forEach((_, t) => {
      const speed = h.wind_speed_10m?.[t];
      const dir = h.wind_direction_10m?.[t];
      const ok = typeof speed === "number" && typeof dir === "number";
      const rad = ((dir || 0) * Math.PI) / 180;
      // Direction is where the wind comes from; u east, v north.
      u[t][k] = ok ? -speed * Math.sin(rad) : NaN;
      v[t][k] = ok ? -speed * Math.cos(rad) : NaN;
      s[t][k] = ok ? speed : NaN;
      g[t][k] = h.wind_gusts_10m?.[t] ?? NaN;
      p[t][k] = h.pressure_msl?.[t] ?? NaN;
    });
  });
  return { times, u, v, s, g, p };
}

// Bilinear value at lat/lon from a grid array, or NaN outside the grid.
export function sample(arr, lat, lon) {
  const fi = (lat - LAT0) / STEP;
  const fj = (lon - LON0) / STEP;
  if (fi < 0 || fj < 0 || fi > NLAT - 1 || fj > NLON - 1) return NaN;
  const i = Math.min(NLAT - 2, Math.floor(fi));
  const j = Math.min(NLON - 2, Math.floor(fj));
  const a = fi - i;
  const b = fj - j;
  const at = (ii, jj) => arr[ii * NLON + jj];
  return (
    at(i, j) * (1 - a) * (1 - b) + at(i, j + 1) * (1 - a) * b + at(i + 1, j) * a * (1 - b) + at(i + 1, j + 1) * a * b
  );
}

// Strongest wind and lowest pressure on the grid at time t.
export function extremes(d, t) {
  let maxK = -1;
  let minK = -1;
  const grid = NLAT * NLON;
  for (let k = 0; k < grid; k++) {
    if (!Number.isNaN(d.s[t][k]) && (maxK < 0 || d.s[t][k] > d.s[t][maxK])) maxK = k;
    if (!Number.isNaN(d.p[t][k]) && (minK < 0 || d.p[t][k] < d.p[t][minK])) minK = k;
  }
  const pos = (k) => [LAT0 + Math.floor(k / NLON) * STEP, LON0 + (k % NLON) * STEP];
  return {
    wind: maxK >= 0 ? { pos: pos(maxK), speed: d.s[t][maxK], gust: d.g[t][maxK] } : null,
    low: minK >= 0 ? { pos: pos(minK), hPa: d.p[t][minK] } : null,
  };
}

function save(body) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify({ at: Date.now(), body }));
  } catch {}
}
function loadSaved() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVED_KEY));
    return s?.body ? s : null;
  } catch {
    return null;
  }
}

async function refresh() {
  say("Loading the wind forecast…");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(forecastUrl(), { signal: ctrl.signal });
    if (res.status === 429) throw new Error("limit");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    data = parseGrid(body);
    data.at = Date.now();
    loadedAt = Date.now();
    save(body);
    pickNow();
    render();
    say(`Updated ${new Date().toLocaleTimeString()}. Drag the slider for the next 2 days.`);
  } catch (e) {
    const saved = loadSaved();
    if (saved && !data) {
      data = parseGrid(saved.body);
      data.at = saved.at;
      pickNow();
      render();
    }
    const why = e.message === "limit" ? "Open-Meteo is busy (too many requests)" : "Couldn't load the wind forecast";
    say(saved ? `${why}. Showing the forecast saved at ${when(saved.at)}.` : `${why}. Try Refresh in a minute.`, true);
  } finally {
    clearTimeout(timer);
  }
}

// ---- Time slider ----

function pickNow() {
  if (!data) return;
  const now = Date.now();
  let best = 0;
  data.times.forEach((t, i) => {
    if (Math.abs(Date.parse(`${t}:00+05:30`) - now) < Math.abs(Date.parse(`${data.times[best]}:00+05:30`) - now)) best = i;
  });
  slider.max = String(data.times.length - 1);
  slider.value = String(best);
}

const timeText = (iso) => {
  const d = new Date(`${iso}:00+05:30`);
  return d.toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const fromDir = (u, v) => COMPASS[Math.round(((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360 / 45) % 8];
const latLon = ([la, lo]) => `${la}°N ${lo}°E`;

function render() {
  if (!data || !map) return;
  const t = Number(slider.value);
  timeLabel.textContent = timeText(data.times[t]);
  const c = NLAT * NLON; // Chennai's own point comes last
  const cs = data.s[t][c];
  const ex = extremes(data, t);
  const parts = [];
  if (!Number.isNaN(cs)) {
    parts.push(
      `<p><b>Chennai:</b> ${Math.round(toWind(cs))} ${windUnit()} from the ${fromDir(data.u[t][c], data.v[t][c])}, gusts ${Math.round(
        toWind(data.g[t][c])
      )} ${windUnit()} · ${Math.round(data.p[t][c])} hPa</p>`
    );
  }
  if (ex.wind) {
    const [, colour, , name] = band(ex.wind.speed);
    parts.push(
      `<p><b>Strongest on the map:</b> <span class="wind-chip" style="--c:${colour}"></span>${Math.round(
        toWind(ex.wind.speed)
      )} ${windUnit()} (gusts ${Math.round(toWind(ex.wind.gust))}) near ${latLon(ex.wind.pos)}${ex.wind.speed >= 31 ? `, ${name.toLowerCase()} strength` : ""}</p>`
    );
  }
  if (ex.low) {
    parts.push(
      `<p><b>Lowest pressure:</b> ${Math.round(ex.low.hPa)} hPa near ${latLon(ex.low.pos)}${
        ex.low.hPa < 1004 ? " (marked L)" : ""
      }</p>`
    );
  }
  summary.innerHTML = parts.join("");

  marks.clearLayers();
  if (ex.low && ex.low.hPa < 1004) {
    L.marker(ex.low.pos, {
      icon: L.divIcon({ className: "", html: `<span class="low-mark">L<small>${Math.round(ex.low.hPa)}</small></span>`, iconSize: null }),
      keyboard: false,
      interactive: false,
    }).addTo(marks);
  }
  L.circleMarker([CHENNAI.lat, CHENNAI.lon], { radius: 4, color: "#fff", weight: 2, fillColor: "#1565c0", fillOpacity: 1, interactive: false }).addTo(marks);
  buildField();
}

// ---- Particles ----

const CELL = 8; // px per field cell
const SPEED = 0.03; // px per frame for each km/h

function buildField() {
  if (!data || !map) return;
  const size = map.getSize();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = size.x * ratio;
  canvas.height = size.y * ratio;
  canvas.style.width = `${size.x}px`;
  canvas.style.height = `${size.y}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  const t = Number(slider.value);
  const cols = Math.ceil(size.x / CELL) + 1;
  const rows = Math.ceil(size.y / CELL) + 1;
  const fu = new Float32Array(cols * rows);
  const fv = new Float32Array(cols * rows);
  const fs = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let q = 0; q < cols; q++) {
      const ll = map.containerPointToLatLng([q * CELL, r * CELL]);
      const k = r * cols + q;
      const u = sample(data.u[t], ll.lat, ll.lng);
      const v = sample(data.v[t], ll.lat, ll.lng);
      fu[k] = u * SPEED;
      fv[k] = -v * SPEED; // screen y grows downwards
      fs[k] = Math.hypot(u, v);
    }
  }
  field = { cols, rows, fu, fv, fs, w: size.x, h: size.y };
  const count = Math.round(Math.min(2500, (size.x * size.y) / 220));
  particles = Array.from({ length: count }, () => spawn({}));
  ctx.clearRect(0, 0, size.x, size.y);
}

function spawn(p) {
  p.x = Math.random() * field.w;
  p.y = Math.random() * field.h;
  p.age = Math.floor(Math.random() * 80);
  return p;
}

function at(x, y) {
  const q = Math.round(x / CELL);
  const r = Math.round(y / CELL);
  if (q < 0 || r < 0 || q >= field.cols || r >= field.rows) return -1;
  return r * field.cols + q;
}

const strokeFor = BANDS.map(([, c]) => c);

function frameStep() {
  raf = requestAnimationFrame(frameStep);
  if (!field) return;
  const ctx = canvas.getContext("2d");
  // Fade the old trails.
  ctx.globalCompositeOperation = "destination-in";
  ctx.fillStyle = "rgba(0,0,0,0.9)";
  ctx.fillRect(0, 0, field.w, field.h);
  ctx.globalCompositeOperation = "source-over";
  ctx.lineWidth = 1.4;
  const paths = strokeFor.map(() => []);
  for (const p of particles) {
    const k = at(p.x, p.y);
    if (k < 0 || Number.isNaN(field.fu[k]) || p.age++ > 90) {
      spawn(p);
      p.age = 0;
      continue;
    }
    const nx = p.x + field.fu[k];
    const ny = p.y + field.fv[k];
    const bi = BANDS.findIndex(([max]) => field.fs[k] < max);
    paths[bi].push(p.x, p.y, nx, ny);
    p.x = nx;
    p.y = ny;
  }
  paths.forEach((segs, i) => {
    if (!segs.length) return;
    ctx.strokeStyle = strokeFor[i];
    ctx.beginPath();
    for (let j = 0; j < segs.length; j += 4) {
      ctx.moveTo(segs[j], segs[j + 1]);
      ctx.lineTo(segs[j + 2], segs[j + 3]);
    }
    ctx.stroke();
  });
}

function start() {
  if (!raf) raf = requestAnimationFrame(frameStep);
}
function stop() {
  cancelAnimationFrame(raf);
  raf = 0;
}

// ---- Screen ----

function renderLegend() {
  $("wind-legend").replaceChildren(
    ...BANDS.map(([, c, range, name]) => {
      const s = document.createElement("span");
      s.style.setProperty("--level", c);
      s.textContent = `${range} ${name}`;
      return s;
    }),
    Object.assign(document.createElement("small"), { textContent: "km/h" })
  );
}

export function initWind() {
  renderLegend();
  $("wind-refresh").addEventListener("click", refresh);
  slider.addEventListener("input", render);
  document.addEventListener("visibilitychange", () => (document.hidden || !visible ? stop() : start()));
}

export async function showWind() {
  visible = true;
  const windy = routeParams().get("page") === "windy";
  home.hidden = windy;
  reader.hidden = !windy;
  if (windy) {
    stop();
    if (!frame.src) frame.src = WINDY_URL;
    return;
  }
  try {
    L = await loadLeaflet();
  } catch (e) {
    return say(`Couldn't open the map (${e.message}).`, true);
  }
  if (!map) {
    map = L.map(box, { zoomControl: true, minZoom: 4, maxZoom: 9 }).fitBounds([
      [LAT0 + 1, LON0],
      [LAT1 - 1, LON1],
    ]);
    addTiles(L, map, box);
    marks = L.layerGroup().addTo(map);
    // Particles are redrawn for the new view after a pan or zoom.
    map.on("movestart zoomstart", () => {
      field = null;
      canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    });
    map.on("moveend zoomend resize", buildField);
  }
  setTimeout(() => {
    map.invalidateSize();
    buildField();
  }, 0);
  if (!data) {
    const saved = loadSaved();
    if (saved) {
      data = parseGrid(saved.body);
      data.at = saved.at;
      pickNow();
    }
  }
  render();
  start();
  if (Date.now() - loadedAt > TTL) refresh();
}

export function hideWind() {
  visible = false;
  stop();
}
