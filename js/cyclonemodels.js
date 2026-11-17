// Model guidance and steering for Cyclone watch, from Open-Meteo (free, no
// key, CORS). Nothing here is IMD's forecast; it is the raw models, read by
// the app:
//
// - Model tracks: each global model's sea-level pressure on a 1° grid around
//   the storm, every 6 hours. Starting from IMD's latest position, the track
//   follows the lowest pressure from step to step (within 300 km), placed
//   between grid points by fitting a curve through the neighbours. It stops
//   when the low fades (less than 1 hPa below the ring around it), leaves the
//   grid, or a day after it meets the coast. Coarse models make a cyclone's
//   core too weak and wide, so the pressures are only for comparison.
// - Steering: GFS winds at 850, 700, 500, 300 and 200 hPa at the storm's
//   (IMD forecast) position, averaged: the "deep-layer mean" wind that pushes
//   a cyclone along. And the 500 hPa subtropical ridge: along the storm's
//   longitude, the latitude where the wind turns from easterly (south of the
//   ridge) to westerly (north of it).
import { km } from "./geo.js";
import { meetsCoast, nearestPlace } from "./coast.js";

const API = "https://api.open-meteo.com/v1/forecast";

export const MODELS = [
  { id: "ecmwf_ifs025", name: "ECMWF", colour: "#f06292" },
  { id: "gfs_seamless", name: "GFS (USA)", colour: "#42a5f5" },
  { id: "ecmwf_aifs025_single", name: "ECMWF AI (AIFS)", colour: "#26c6da" },
  { id: "ukmo_global_deterministic_10km", name: "UK Met Office", colour: "#b388ff" },
  { id: "icon_seamless", name: "ICON (Germany)", colour: "#9ccc65" },
];

const STEP = 1; // grid spacing, degrees
const POLEWARD = 10; // grid reach from the storm, degrees
const EQUATORWARD = 6;
const SPAN_W = 9;
const SPAN_E = 8;

// Longitudes are kept continuous around the storm (a Pacific storm's grid may
// run past 180°); the query wraps them into −180…180.
const wrap = (x) => ((((x + 180) % 360) + 360) % 360) - 180;

function grid(lat0, lon0) {
  const la = Math.round(lat0);
  const lo = Math.round(lon0);
  const north = lat0 >= 0;
  const lats = [];
  const lons = [];
  const lo0 = la - (north ? EQUATORWARD : POLEWARD);
  const hi0 = la + (north ? POLEWARD : EQUATORWARD);
  for (let y = Math.max(-60, lo0); y <= Math.min(60, hi0); y += STEP) lats.push(y);
  for (let x = lo - SPAN_W; x <= lo + SPAN_E; x += STEP) lons.push(x);
  return { lats, lons };
}

/**
 * A land test from the grid's elevations (Open-Meteo gives each point's
 * height; the sea is 0). A place is land when most of the four grid points
 * around it are, so it is only good to about 50 km.
 */
export function landTest(g) {
  if (!g?.elev) return null;
  const { lats, lons, elev } = g;
  return (lat, lon) => {
    const i = Math.floor((lat - lats[0]) / STEP);
    const j = Math.floor((lon - lons[0]) / STEP);
    if (i < 0 || j < 0 || i >= lats.length - 1 || j >= lons.length - 1) return null;
    const fy = (lat - lats[i]) / STEP;
    const fx = (lon - lons[j]) / STEP;
    const at = (a, b) => (elev[a * lons.length + b] > 0 ? 1 : 0);
    const v = at(i, j) * (1 - fy) * (1 - fx) + at(i, j + 1) * (1 - fy) * fx + at(i + 1, j) * fy * (1 - fx) + at(i + 1, j + 1) * fy * fx;
    return v >= 0.5;
  };
}

// Where segment p→q first goes from sea to land: India's coasts by their
// lines, elsewhere the land test (checked in 10 steps).
function landing(p, q, isLand) {
  if (!isLand) return meetsCoast(p, q);
  if (isLand(p[0], p[1]) !== false) return null;
  for (let k = 1; k <= 10; k++) {
    const f = k / 10;
    const pt = [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f];
    if (isLand(pt[0], pt[1])) return { f, pt };
  }
  return null;
}

// One retry: Open-Meteo sometimes drops a big request.
async function getJson(url, ms = 45000) {
  try {
    return await getOnce(url, ms);
  } catch {
    await new Promise((r) => setTimeout(r, 3000));
    return getOnce(url, ms);
  }
}

async function getOnce(url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Fits a parabola through three values; the offset (−0.5…0.5 steps) of its low.
function vertex(a, b, c) {
  const den = a - 2 * b + c;
  if (!(den > 0)) return 0;
  return Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den));
}

/**
 * Follows the low in one model's pressure field.
 * field(t) → 2-D array [latIndex][lonIndex] of hPa (null over missing).
 */
export function follow({ lats, lons, times, field, isLand }, start) {
  const track = [];
  let pos = [start.lat, start.lon];
  let landedAt = null;
  const first = times.findIndex((t) => t >= start.t - 3 * 3600);
  if (first < 0) return track;
  for (let k = first; k < times.length; k++) {
    const f = field(k);
    const reach = track.length ? 300 : 350;
    let best = null;
    for (let i = 0; i < lats.length; i++) {
      for (let j = 0; j < lons.length; j++) {
        const p = f[i][j];
        if (p == null) continue;
        if (km(pos, [lats[i], lons[j]]) > reach) continue;
        if (!best || p < best.p) best = { i, j, p };
      }
    }
    if (!best) break;
    const { i, j } = best;
    // A low at the grid's edge may be a bigger one outside it.
    if (i === 0 || j === 0 || i === lats.length - 1 || j === lons.length - 1) break;
    const di = vertex(f[i - 1][j] ?? best.p, best.p, f[i + 1][j] ?? best.p);
    const dj = vertex(f[i][j - 1] ?? best.p, best.p, f[i][j + 1] ?? best.p);
    const here = [lats[i] + di * STEP, lons[j] + dj * STEP];
    // How deep: the ring 300–600 km out against the centre.
    let sum = 0;
    let n = 0;
    for (let a = 0; a < lats.length; a++) {
      for (let b = 0; b < lons.length; b++) {
        const p = f[a][b];
        if (p == null) continue;
        const d = km(here, [lats[a], lons[b]]);
        if (d >= 300 && d <= 600) {
          sum += p;
          n++;
        }
      }
    }
    const depth = n ? sum / n - best.p : 0;
    if (depth < 1) break;
    const pt = { t: times[k], lat: here[0], lon: here[1], hPa: best.p, depth };
    const prev = track[track.length - 1];
    if (prev && !landedAt) {
      const hit = landing([prev.lat, prev.lon], here, isLand);
      if (hit) landedAt = { t: prev.t + (pt.t - prev.t) * hit.f, lat: hit.pt[0], lon: hit.pt[1] };
    }
    track.push(pt);
    pos = here;
    if (landedAt && pt.t - landedAt.t >= 24 * 3600) break;
  }
  track.landfall = landedAt;
  return track;
}

/**
 * Every model's track from the agency's position { lat, lon, t (unix s) }.
 * india: find landfall on India's coast lines and name the nearest place;
 * otherwise landfall comes from the grid's land test. Returns { models, land }
 * where land is the grid's elevations (for landTest).
 */
export async function modelTracks(start, { india = true } = {}) {
  const { lats, lons } = grid(start.lat, start.lon);
  const la = [];
  const lo = [];
  for (const y of lats) for (const x of lons) la.push(y), lo.push(+wrap(x).toFixed(2));
  const qs = new URLSearchParams({
    latitude: la.join(","),
    longitude: lo.join(","),
    hourly: "pressure_msl",
    models: MODELS.map((m) => m.id).join(","),
    past_days: "1",
    forecast_days: "7",
    temporal_resolution: "hourly_6",
    timeformat: "unixtime",
    timezone: "GMT",
  });
  const data = await getJson(`${API}?${qs}`);
  const pts = Array.isArray(data) ? data : [data];
  const times = pts[0].hourly.time;
  const land = { lats, lons, elev: pts.map((p) => p.elevation ?? 0) };
  const isLand = india ? null : landTest(land);
  const out = [];
  for (const m of MODELS) {
    const key = `pressure_msl_${m.id}`;
    if (!pts[0].hourly[key]) continue;
    const field = (k) => {
      const rows = [];
      for (let i = 0; i < lats.length; i++) {
        const row = [];
        for (let j = 0; j < lons.length; j++) row.push(pts[i * lons.length + j].hourly[key][k] ?? null);
        rows.push(row);
      }
      return rows;
    };
    const track = follow({ lats, lons, times, field, isLand }, start);
    if (track.length < 2) {
      out.push({ ...m, track, lost: true });
      continue;
    }
    const lf = track.landfall;
    out.push({
      ...m,
      track,
      landfall: lf ? { ...lf, place: india ? nearestPlace([lf.lat, lf.lon], km) : null } : null,
      lowest: Math.min(...track.map((p) => p.hPa)),
      last: track[track.length - 1],
    });
  }
  return { models: out, land };
}

// ---- Steering ----

const LEVELS = [850, 700, 500, 300, 200];
const uv = (speed, from) => {
  const r = (from * Math.PI) / 180;
  return [-speed * Math.sin(r), -speed * Math.cos(r)]; // [east, north]
};

/**
 * GFS steering along a track of { t (unix s), lat, lon } points (IMD's
 * forecast): the deep-layer mean wind at each, and the 500 hPa ridge
 * latitude along each point's longitude.
 */
export async function steering(points) {
  if (!points.length) return [];
  // The storm points, then a column of points for the ridge at each distinct
  // whole-degree longitude.
  const lonsCol = [...new Set(points.map((p) => Math.round(p.lon)))];
  // Away from the equator: north in the northern hemisphere, south in the
  // southern (where the ridge lies south of the storm).
  const sign = points[0].lat >= 0 ? 1 : -1;
  const colLats = [];
  for (let y = 5; y <= 40; y++) colLats.push(sign * y);
  const la = points.map((p) => +p.lat.toFixed(2));
  const lo = points.map((p) => +wrap(p.lon).toFixed(2));
  for (const x of lonsCol) for (const y of colLats) la.push(y), lo.push(+wrap(x).toFixed(2));
  const vars = LEVELS.flatMap((l) => [`wind_speed_${l}hPa`, `wind_direction_${l}hPa`]);
  const qs = new URLSearchParams({
    latitude: la.join(","),
    longitude: lo.join(","),
    hourly: vars.join(","),
    models: "gfs_seamless",
    past_days: "1",
    forecast_days: "6",
    temporal_resolution: "hourly_3",
    wind_speed_unit: "kmh",
    timeformat: "unixtime",
    timezone: "GMT",
  });
  const data = await getJson(`${API}?${qs}`);
  const all = Array.isArray(data) ? data : [data];
  const times = all[0].hourly.time;
  const at = (t) => {
    let best = 0;
    for (let k = 1; k < times.length; k++) if (Math.abs(times[k] - t) < Math.abs(times[best] - t)) best = k;
    return Math.abs(times[best] - t) <= 3 * 3600 ? best : -1;
  };
  return points.map((p, n) => {
    const k = at(p.t);
    if (k < 0) return { ...p, missing: true };
    const h = all[n].hourly;
    let e = 0;
    let no = 0;
    let c = 0;
    for (const l of LEVELS) {
      const s = h[`wind_speed_${l}hPa`][k];
      const d = h[`wind_direction_${l}hPa`][k];
      if (s == null || d == null) continue;
      const [a, b] = uv(s, d);
      e += a;
      no += b;
      c++;
    }
    const out = { ...p };
    if (c) {
      e /= c;
      no /= c;
      out.speed = Math.hypot(e, no);
      out.towards = ((Math.atan2(e, no) * 180) / Math.PI + 360) % 360;
    }
    // Ridge: going poleward from 3° on the equator side of the storm, the
    // first latitude where the 500 hPa wind turns westerly (blowing east).
    const ci = lonsCol.indexOf(Math.round(p.lon));
    const base = points.length + ci * colLats.length;
    let prevU = null;
    for (let y = 0; y < colLats.length; y++) {
      const hh = all[base + y].hourly;
      const s = hh.wind_speed_500hPa[k];
      const d = hh.wind_direction_500hPa[k];
      if (s == null || d == null) continue;
      const u = uv(s, d)[0];
      if (Math.abs(colLats[y]) >= Math.abs(p.lat) - 3 && prevU != null && prevU < 0 && u >= 0) {
        // Linear between the two latitudes.
        out.ridge = colLats[y - 1] + (colLats[y] - colLats[y - 1]) * (-prevU / (u - prevU));
        break;
      }
      prevU = u;
    }
    return out;
  });
}

const DIRS = ["north", "north-northeast", "northeast", "east-northeast", "east", "east-southeast", "southeast", "south-southeast", "south", "south-southwest", "southwest", "west-southwest", "west", "west-northwest", "northwest", "north-northwest"];
export const compass = (deg) => DIRS[Math.round(deg / 22.5) % 16];
