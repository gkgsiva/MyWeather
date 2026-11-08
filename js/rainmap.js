// Rain map (#rainmap): how much rain fell over the last 1, 3, 6, 12 or 24
// hours across Tamil Nadu, filled in between the TN-SMART rain gauges.
//
// TN-SMART's hourly files have about 1,500 gauges. Each gauge's hours are
// added up for the window; gauges Station health finds suspect are left out.
// The map is filled by inverse-distance weighting (power 2) from the gauges
// within 20 km of each 2 km cell; cells with no gauge that close stay blank,
// rather than guessing. District figures are the mean of the district's
// gauges and its wettest gauge, straight from the readings.
//
// (An earlier version estimated rain from the radar; on 8 Nov 2026 it saw
// only about 7% of the gauges' rain, so gauges alone are used.)
import { loadLeaflet, addTiles } from "./stationmap.js";
import { mercatorRows, ist } from "./radarmap.js";
import { BASE, currentRainDay, shiftDay, gaugeKey } from "./gaugedays.js";
import { gaugeFlags, skipSuspects, isSuspect } from "./health.js";
import { TN_DISTRICTS } from "./districts.js";

// The grid: plain latitude/longitude around Tamil Nadu, about 2 km cells.
const BOX = { lon0: 76.1, lon1: 80.5, lat0: 7.9, lat1: 13.7 };
const STEP = 0.02; // degrees
const CW = Math.round((BOX.lon1 - BOX.lon0) / STEP);
const CH = Math.round((BOX.lat1 - BOX.lat0) / STEP);
const AS_PRODUCT = { crop: [0, 0, CW, CH], lon: [BOX.lon0, 0, 1 / STEP], lat: [BOX.lat1, 0, 1 / STEP] };
const latOfRow = (y) => BOX.lat1 - (y + 0.5) * STEP;
const lonOfCol = (x) => BOX.lon0 + (x + 0.5) * STEP;
const cellOf = (lat, lon) => {
  const x = Math.floor((lon - BOX.lon0) / STEP);
  const y = Math.floor((BOX.lat1 - lat) / STEP);
  return x < 0 || y < 0 || x >= CW || y >= CH ? -1 : y * CW + x;
};
const REACH_KM = 20;
const KM = 111.2;

// ---- Districts (TN-SMART outlines on the grid, to keep the fill inside TN) ----

const DISTRICTS_URL = "https://beta-tnsmart.rimes.int/DATA/countries/IND/district_tn.geojson";
const RASTER_KEY = `myweather.rainmap.districts.${CW}x${CH}`;
let raster = null; // Uint8Array(CW*CH): 0 = outside TN, else index into TN_DISTRICTS + 1

const norm = (s) => String(s).toLowerCase().replace(/[^a-z]/g, "");

function rasterise(geo) {
  const out = new Uint8Array(CW * CH);
  for (const f of geo.features) {
    const id = TN_DISTRICTS.findIndex(([n]) => norm(n) === norm(f.properties.district_name)) + 1;
    if (!id) continue;
    const g = f.geometry;
    const polys = g.type === "MultiPolygon" ? g.coordinates : [g.coordinates];
    // Even-odd scanline fill over all rings of the district.
    const rows = new Map(); // y -> [x crossings]
    for (const poly of polys)
      for (const ring of poly)
        for (let i = 0; i + 1 < ring.length; i++) {
          const [x0, y0] = ring[i];
          const [x1, y1] = ring[i + 1];
          if (y0 === y1) continue;
          const lo = Math.min(y0, y1);
          const hi = Math.max(y0, y1);
          const r0 = Math.max(0, Math.ceil((BOX.lat1 - hi) / STEP - 0.5));
          const r1 = Math.min(CH - 1, Math.floor((BOX.lat1 - lo) / STEP - 0.5));
          for (let y = r0; y <= r1; y++) {
            const lat = latOfRow(y);
            if (lat < lo || lat >= hi) continue;
            const lon = x0 + ((lat - y0) * (x1 - x0)) / (y1 - y0);
            let list = rows.get(y);
            if (!list) rows.set(y, (list = []));
            list.push((lon - BOX.lon0) / STEP - 0.5);
          }
        }
    for (const [y, xs] of rows) {
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2)
        for (let x = Math.max(0, Math.ceil(xs[k])); x <= Math.min(CW - 1, Math.floor(xs[k + 1])); x++) out[y * CW + x] = id;
    }
  }
  return out;
}

async function districtRaster() {
  if (raster) return raster;
  try {
    const s = localStorage.getItem(RASTER_KEY);
    if (s) {
      const r = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
      if (r.length === CW * CH) return (raster = r);
    }
  } catch {}
  const res = await fetch(DISTRICTS_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  raster = rasterise(await res.json());
  try {
    let bin = "";
    for (let i = 0; i < raster.length; i += 8192) bin += String.fromCharCode.apply(null, raster.subarray(i, i + 8192));
    localStorage.setItem(RASTER_KEY, btoa(bin));
  } catch {}
  return raster;
}

// ---- Gauges ----

// TN-SMART hour columns of a rain day as [{ key, end (ms) }]: "09:30 AM" is
// the hour to 9:30 AM IST on the day before the file's date.
function hourCols(day, row) {
  const start = Date.parse(`${shiftDay(day, -1)}T08:30:00+05:30`);
  return Object.keys(row)
    .filter((k) => /^\d\d:\d\d [AP]M$/.test(k))
    .map((key, i) => ({ key, end: start + (i + 1) * 3600 * 1000 }));
}

const dayFiles = new Map(); // day -> { at, rows }
async function hourlyRows(day) {
  const running = day >= currentRainDay();
  const had = dayFiles.get(day);
  if (had && (!running || Date.now() - had.at < 10 * 60 * 1000)) return had.rows;
  const res = await fetch(`${BASE}hourly_rainfall_${day}.json${running ? `?t=${Date.now()}` : ""}`, { cache: running ? "no-store" : "default" });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const rows = await res.json();
  dayFiles.set(day, { at: Date.now(), rows });
  return rows;
}

/**
 * Each gauge's rain over the last `hours` hours of data:
 * { end (ms), gauges: [{ name, district, lat, lon, mm }] }. A gauge needs at
 * least 90% of the hours; suspect gauges (Station health) are left out.
 */
export async function gaugeWindow(hours) {
  const today = currentRainDay();
  const days = [shiftDay(today, -1), today];
  const files = await Promise.all(days.map((d) => hourlyRows(d).catch(() => [])));
  const series = new Map();
  let end = 0;
  files.forEach((rows, k) => {
    if (!rows.length) return;
    const cols = hourCols(days[k], rows[0]);
    const flags = skipSuspects() ? gaugeFlags(rows) : new Map();
    for (const r of rows) {
      if (typeof r.latitude !== "number" || isSuspect(flags.get(gaugeKey(r)))) continue;
      const key = gaugeKey(r);
      let s = series.get(key);
      if (!s) series.set(key, (s = { name: r.station_name, district: r.district_name, lat: r.latitude, lon: r.longitude, hours: new Map() }));
      for (const c of cols) {
        const v = r[c.key];
        if (typeof v === "number" && v >= 0) {
          s.hours.set(c.end, v);
          if (c.end > end && c.end <= Date.now()) end = c.end;
        }
      }
    }
  });
  if (!end) return { end: 0, gauges: [] };
  const want = Array.from({ length: hours }, (_, i) => end - i * 3600 * 1000);
  const gauges = [];
  for (const s of series.values()) {
    const got = want.filter((t) => s.hours.has(t));
    if (got.length < Math.ceil(hours * 0.9)) continue;
    gauges.push({ name: s.name, district: s.district, lat: s.lat, lon: s.lon, mm: got.reduce((a, t) => a + s.hours.get(t), 0) });
  }
  return { end, gauges };
}

// ---- Filling in between the gauges ----

/** Inverse-distance weighted mm per cell (NaN = no gauge within 20 km or outside TN). */
export function interpolate(gauges, inside) {
  // Bucket the gauges by 0.2° to find neighbours fast.
  const B = 0.2;
  const buckets = new Map();
  const bk = (lat, lon) => `${Math.floor(lat / B)}|${Math.floor(lon / B)}`;
  for (const g of gauges) {
    const k = bk(g.lat, g.lon);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(g);
  }
  const out = new Float32Array(CW * CH).fill(NaN);
  for (let y = 0; y < CH; y++) {
    const lat = latOfRow(y);
    const cos = Math.cos((lat * Math.PI) / 180);
    const by = Math.floor(lat / B);
    for (let x = 0; x < CW; x++) {
      const i = y * CW + x;
      if (inside && !inside[i]) continue;
      const lon = lonOfCol(x);
      const bx = Math.floor(lon / B);
      let wsum = 0;
      let vsum = 0;
      let exact = null;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const list = buckets.get(`${by + dy}|${bx + dx}`);
          if (!list) continue;
          for (const g of list) {
            const d2 = ((g.lat - lat) * KM) ** 2 + ((g.lon - lon) * KM * cos) ** 2;
            if (d2 > REACH_KM * REACH_KM) continue;
            if (d2 < 0.25) exact = g.mm;
            const w = 1 / d2;
            wsum += w;
            vsum += w * g.mm;
          }
        }
      if (exact !== null) out[i] = exact;
      else if (wsum) out[i] = vsum / wsum;
    }
  }
  return out;
}

// ---- Screen ----

const BANDS = [
  [0.5, "#c6e6ff", "0.5"],
  [2.5, "#7cc4ff", "2.5"],
  [7.5, "#2b8cff", "7.5"],
  [15, "#1b5fd1", "15"],
  [35, "#3a2fb8", "35"],
  [65, "#7d1fb0", "65"],
  [115, "#c2185b", "115"],
  [205, "#ff6d00", "205+ mm"],
];
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const BAND_RGB = BANDS.map(([, c]) => hexRgb(c));
const fmt = (v) => (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10).toString();
const HOURS_KEY = "myweather.rainmap.hours";

const $ = (id) => document.getElementById(id);
let L = null;
let map = null;
let overlay = null;
let overlayUrl = "";
let gaugeLayer = null;
let shown = null; // { mm, hours, gauges }
let run = 0;

function say(text, error = false) {
  const s = $("rmap-status");
  s.textContent = text;
  s.className = error ? "status error" : "status";
}

async function fillImage(mm) {
  const rows = mercatorRows(AS_PRODUCT);
  const c = document.createElement("canvas");
  c.width = CW;
  c.height = CH;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(CW, CH);
  for (let j = 0; j < CH; j++)
    for (let x = 0; x < CW; x++) {
      const v = mm[rows[j] * CW + x];
      if (!(v >= BANDS[0][0])) continue;
      let k = 0;
      while (k + 1 < BANDS.length && v >= BANDS[k + 1][0]) k++;
      const o = (j * CW + x) * 4;
      [img.data[o], img.data[o + 1], img.data[o + 2]] = BAND_RGB[k];
      img.data[o + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  return URL.createObjectURL(blob);
}

function nearestGauge(lat, lon) {
  let best = null;
  let bd = Infinity;
  const cos = Math.cos((lat * Math.PI) / 180);
  for (const g of shown?.gauges || []) {
    const d = Math.hypot((g.lat - lat) * KM, (g.lon - lon) * KM * cos);
    if (d < bd) {
      bd = d;
      best = g;
    }
  }
  return best ? { g: best, km: bd } : null;
}

function ensureMap() {
  if (map) return;
  const box = $("rmap-map");
  map = L.map(box, { zoomControl: true }).setView([10.9, 78.4], 6);
  addTiles(L, map, box);
  map.on("click", (e) => {
    if (!shown) return;
    const c = cellOf(e.latlng.lat, e.latlng.lng);
    const v = c < 0 ? NaN : shown.mm[c];
    const n = nearestGauge(e.latlng.lat, e.latlng.lng);
    const near = n ? `<br>Nearest gauge: ${n.g.name}, ${fmt(n.km)} km away: ${fmt(n.g.mm)} mm` : "";
    L.popup()
      .setLatLng(e.latlng)
      .setContent(
        (Number.isNaN(v) ? "No gauge within 20 km" : `About ${fmt(v)} mm in the last ${shown.hours} h (from the gauges around)`) + near
      )
      .openOn(map);
  });
}

function renderDistricts(gauges) {
  const by = new Map();
  for (const g of gauges) {
    const d = by.get(g.district) || { n: 0, sum: 0, top: null };
    d.n++;
    d.sum += g.mm;
    if (!d.top || g.mm > d.top.mm) d.top = g;
    by.set(g.district, d);
  }
  const rows = [...by.entries()].map(([name, d]) => ({ name, mean: d.sum / d.n, top: d.top, n: d.n })).sort((a, b) => b.mean - a.mean);
  const most = Math.max(1, ...rows.map((r) => r.mean));
  $("rmap-districts").replaceChildren(
    ...rows.map((r) => {
      const li = document.createElement("li");
      li.className = "rank-row rr-row";
      li.innerHTML = '<span class="rank-name"></span><span class="rank-val"></span><span class="rank-bar"><i></i></span><small class="wl-why"></small>';
      li.querySelector(".rank-name").textContent = r.name;
      li.querySelector(".rank-val").textContent = `${fmt(r.mean)} mm`;
      li.querySelector(".wl-why").textContent = `Wettest: ${r.top.name} ${fmt(r.top.mm)} mm · ${r.n} gauges`;
      const bar = li.querySelector("i");
      bar.style.width = `${Math.min(100, (r.mean / most) * 100)}%`;
      bar.style.background = "#2b8cff";
      return li;
    })
  );
}

async function load() {
  const me = ++run;
  const hours = Number($("rmap-hours").value);
  say("Reading the TN-SMART gauges…");
  try {
    const [w, inside] = await Promise.all([gaugeWindow(hours), districtRaster()]);
    if (me !== run) return;
    if (!w.end || !w.gauges.length) return say("No gauge readings for these hours yet.", true);
    const mm = interpolate(w.gauges, inside);
    shown = { mm, hours, gauges: w.gauges };
    const url = await fillImage(mm);
    if (me !== run) return URL.revokeObjectURL(url);
    if (map) {
      const b = [
        [BOX.lat1 - CH * STEP, BOX.lon0],
        [BOX.lat1, BOX.lon0 + CW * STEP],
      ];
      if (!overlay) overlay = L.imageOverlay(url, b, { opacity: 0.75, interactive: false, className: "rr-layer" }).addTo(map);
      else overlay.setUrl(url);
      if (overlayUrl) URL.revokeObjectURL(overlayUrl);
      overlayUrl = url;
      gaugeLayer?.remove();
      gaugeLayer = L.layerGroup(
        w.gauges
          .filter((g) => g.mm >= 0.5)
          .map((g) =>
            L.circleMarker([g.lat, g.lon], { radius: 2.5, weight: 0.5, color: "#000", fillColor: "#fff", fillOpacity: 0.9 }).bindPopup(
              `${g.name} (${g.district})<br>${fmt(g.mm)} mm in ${hours} h`
            )
          )
      );
      if ($("rmap-dots").checked) gaugeLayer.addTo(map);
    }
    const t = ist(new Date(w.end));
    $("rmap-when").textContent = `Rain, ${hours} h to ${t}, from ${w.gauges.length} gauges`;
    const wet = w.gauges.filter((g) => g.mm >= 2.5).length;
    const top = w.gauges.reduce((a, g) => (g.mm > a.mm ? g : a), w.gauges[0]);
    say(
      `${hours} h to ${t}: ${wet} of ${w.gauges.length} gauges had 2.5 mm or more` +
        (top.mm > 0 ? `; wettest ${top.name} (${top.district}) ${fmt(top.mm)} mm.` : ".") +
        " Tap the map for a spot."
    );
    renderDistricts(w.gauges);
  } catch (e) {
    if (me !== run) return;
    say(
      /Failed to fetch|NetworkError|Load failed/.test(e.message) ? "Couldn't read the TN-SMART gauges. Check the connection." : `Couldn't make the map (${e.message}).`,
      true
    );
  }
}

export function initRainMap() {
  const hours = $("rmap-hours");
  try {
    const h = localStorage.getItem(HOURS_KEY);
    if ([...hours.options].some((o) => o.value === h)) hours.value = h;
  } catch {}
  hours.addEventListener("change", () => {
    try {
      localStorage.setItem(HOURS_KEY, hours.value);
    } catch {}
    load();
  });
  $("rmap-refresh").addEventListener("click", load);
  $("rmap-dots").addEventListener("change", () => {
    if (!gaugeLayer) return;
    if ($("rmap-dots").checked) gaugeLayer.addTo(map);
    else gaugeLayer.remove();
  });
  $("rmap-legend").replaceChildren(
    ...BANDS.map(([, c, label]) => {
      const s = document.createElement("span");
      s.style.setProperty("--level", c);
      s.textContent = label;
      return s;
    })
  );
}

let shownAt = 0;
export async function showRainMap() {
  try {
    L = await loadLeaflet();
    ensureMap();
    setTimeout(() => map.invalidateSize(), 0);
  } catch (e) {
    $("rmap-map").textContent = `Couldn't open the map (${e.message}).`;
  }
  if (shown && Date.now() - shownAt < 10 * 60 * 1000) return;
  shownAt = Date.now();
  load();
}
