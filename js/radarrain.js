// Radar rain (#radarrain): how much rain fell in the last 1, 3 or 6 hours,
// estimated from the Tamil Nadu radar mosaic (js/mosaic.js), between and
// beyond the rain gauges, and how the radar compares with the TN-SMART gauges.
//
// Reflectivity to rain rate: Marshall–Palmer, Z = 200 R^1.6, with dBZ capped
// at 55 (hail would otherwise read as a cloudburst). IMD's MAX Z is the
// strongest echo anywhere in the column, not at the ground, so the radar
// usually reads high in showers and low in drizzle; the gauge check below
// shows by how much. Each 10-minute step of the mosaic adds its rate / 6.
//
// Steps are kept on the phone (IndexedDB, about 120 KB each on a 3.6 km grid)
// for 7 hours, so the 6-hour total covers whatever the app has seen: one
// download covers the last 3 hours; opening a radar screen again later fills
// in more. The screen says how many of the steps it has.
import { loadLeaflet, addTiles } from "./stationmap.js";
import { buildMosaic, onMosaic, GRID } from "./mosaic.js";
import { mercatorRows, ist } from "./radarmap.js";
import { idbGet, idbPut, idbKeys, idbDelete } from "./idb.js";
import { BASE, currentRainDay, shiftDay, gaugeKey } from "./gaugedays.js";
import { gaugeFlags, skipSuspects, isSuspect } from "./health.js";
import { bindSaver } from "./datasaver.js";
import { TN_DISTRICTS } from "./districts.js";

const F = 3; // mosaic cells per stored cell, each way
export const CW = Math.ceil(GRID.W / F);
export const CH = Math.ceil(GRID.H / F);
const STEP_MS = GRID.STEP_MIN * 60000;
const KEEP_MS = 7 * 3600 * 1000;

// mm in one 10-minute step, by dBZ.
const MM = new Float32Array(81);
for (let d = 1; d <= 80; d++) MM[d] = ((10 ** (Math.min(d, 55) / 10) / 200) ** (1 / 1.6)) / 6;

// The stored grid as a Radar map style product, for placing it on the map.
const COARSE = { crop: [0, 0, CW, CH], lon: [GRID.lon0, 0, GRID.PPD_LON / F], lat: [GRID.lat1, 0, GRID.PPD_LAT / F] };
export const cellOf = (lat, lon) => {
  const x = Math.floor((lon - GRID.lon0) * COARSE.lon[2]);
  const y = Math.floor((GRID.lat1 - lat) * COARSE.lat[2]);
  return x < 0 || y < 0 || x >= CW || y >= CH ? -1 : y * CW + x;
};
const latOfRow = (y) => GRID.lat1 - (y + 0.5) / COARSE.lat[2];
const lonOfCol = (x) => GRID.lon0 + (x + 0.5) / COARSE.lon[2];

// ---- Steps ----

const steps = new Map(); // time (ms) -> { v: Uint16Array (0.01 mm), radars }
let loadedKeys = false;

function coarse(dbz) {
  const out = new Uint16Array(CW * CH);
  const { W, H } = GRID;
  for (let cy = 0; cy < CH; cy++)
    for (let cx = 0; cx < CW; cx++) {
      let sum = 0;
      let n = 0;
      for (let y = cy * F; y < Math.min(H, cy * F + F); y++)
        for (let x = cx * F; x < Math.min(W, cx * F + F); x++) {
          sum += MM[dbz[y * W + x]];
          n++;
        }
      out[cy * CW + cx] = Math.round((sum / n) * 100);
    }
  return out;
}

// Keep each new mosaic's steps (a later build may have more radars in a step).
// In memory at once (screens read them right after a build); saved after.
onMosaic(async (m) => {
  const fresh = [];
  for (const f of m.frames) {
    const t = f.time.valueOf();
    const radars = f.scans.filter((s) => s.time).length;
    const had = steps.get(t);
    if (had && had.radars > radars) continue;
    const rec = { v: coarse(f.dbz), radars };
    steps.set(t, rec);
    fresh.push([t, rec]);
  }
  for (const [t, rec] of fresh) {
    const had = await idbGet("rain", t);
    if (!had || had.radars <= rec.radars) idbPut("rain", t, rec);
  }
  const old = Date.now() - KEEP_MS;
  for (const k of await idbKeys("rain")) if (k < old) idbDelete("rain", k);
  for (const k of steps.keys()) if (k < old) steps.delete(k);
});

async function allSteps() {
  if (!loadedKeys) {
    for (const k of await idbKeys("rain")) {
      if (k < Date.now() - KEEP_MS || steps.has(k)) continue;
      const rec = await idbGet("rain", k);
      if (rec?.v) steps.set(k, rec);
    }
    loadedKeys = true;
  }
  return steps;
}

/**
 * Radar rain over (end − hours, end]: { mm: Float32Array(CW*CH), have, want, end }.
 * end defaults to the latest step kept.
 */
export async function radarTotals(hours, end = null) {
  const all = await allSteps();
  const keys = [...all.keys()];
  end = end ?? (keys.length ? Math.max(...keys) : Date.now());
  const from = end - hours * 3600 * 1000;
  const mm = new Float32Array(CW * CH);
  let have = 0;
  for (const [t, rec] of all) {
    if (t <= from || t > end) continue;
    have++;
    for (let i = 0; i < mm.length; i++) mm[i] += rec.v[i] / 100;
  }
  return { mm, have, want: (hours * 3600 * 1000) / STEP_MS, end };
}

// ---- Districts (TN-SMART outlines, rasterised onto the stored grid) ----

const DISTRICTS_URL = "https://beta-tnsmart.rimes.int/DATA/countries/IND/district_tn.geojson";
const RASTER_KEY = `myweather.radarrain.districts.${CW}x${CH}`;
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
          const r0 = Math.max(0, Math.ceil((GRID.lat1 - hi) * COARSE.lat[2] - 0.5));
          const r1 = Math.min(CH - 1, Math.floor((GRID.lat1 - lo) * COARSE.lat[2] - 0.5));
          for (let y = r0; y <= r1; y++) {
            const lat = latOfRow(y);
            if (lat < lo || lat >= hi) continue;
            const lon = x0 + ((lat - y0) * (x1 - x0)) / (y1 - y0);
            let list = rows.get(y);
            if (!list) rows.set(y, (list = []));
            list.push((lon - GRID.lon0) * COARSE.lon[2] - 0.5);
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
      const bin = atob(s);
      raster = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      if (raster.length === CW * CH) return raster;
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

/** { name: { mean, max } } of a total over each district's cells. */
export async function districtTotals(mm) {
  const r = await districtRaster();
  const sum = new Float64Array(TN_DISTRICTS.length + 1);
  const n = new Uint32Array(TN_DISTRICTS.length + 1);
  const max = new Float32Array(TN_DISTRICTS.length + 1);
  for (let i = 0; i < r.length; i++) {
    const id = r[i];
    if (!id) continue;
    sum[id] += mm[i];
    n[id]++;
    if (mm[i] > max[id]) max[id] = mm[i];
  }
  const out = {};
  TN_DISTRICTS.forEach(([name], k) => {
    if (n[k + 1]) out[name] = { mean: sum[k + 1] / n[k + 1], max: max[k + 1] };
  });
  return out;
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
 * Each gauge's rain over the last `hours` complete hours with data:
 * { end (ms), gauges: [{ name, district, lat, lon, mm }] }. Gauges with a
 * missing hour or flagged as suspect (Station health) are left out.
 */
export async function gaugeWindow(hours) {
  const today = currentRainDay();
  const days = [shiftDay(today, -1), today];
  const files = await Promise.all(days.map((d) => hourlyRows(d).catch(() => [])));
  // Gauge -> [{ end, v }]
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
        if (typeof v === "number") {
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
    if (!want.every((t) => s.hours.has(t))) continue;
    gauges.push({ name: s.name, district: s.district, lat: s.lat, lon: s.lon, mm: want.reduce((a, t) => a + s.hours.get(t), 0) });
  }
  return { end, gauges };
}

/**
 * Radar against gauges over the last `hours` hours of gauge data:
 * { end, have, want, pairs: [{ ...gauge, radar }], ratio, wetGauges, missed, falseRain, byDistrict }.
 */
export async function radarVsGauges(hours) {
  const g = await gaugeWindow(hours);
  if (!g.end) return null;
  const t = await radarTotals(hours, g.end);
  const pairs = g.gauges
    .map((x) => {
      const c = cellOf(x.lat, x.lon);
      return c < 0 ? null : { ...x, radar: t.mm[c] };
    })
    .filter(Boolean);
  const wet = pairs.filter((p) => p.mm >= 1);
  const sumG = wet.reduce((a, p) => a + p.mm, 0);
  const sumR = wet.reduce((a, p) => a + p.radar, 0);
  const byDistrict = new Map();
  for (const p of wet) {
    const d = byDistrict.get(p.district) || { district: p.district, n: 0, gauge: 0, radar: 0 };
    d.n++;
    d.gauge += p.mm;
    d.radar += p.radar;
    byDistrict.set(p.district, d);
  }
  return {
    end: g.end,
    have: t.have,
    want: t.want,
    pairs,
    wetGauges: wet.length,
    ratio: sumG ? sumR / sumG : null,
    missed: pairs.filter((p) => p.mm >= 5 && p.radar < 1).length,
    falseRain: pairs.filter((p) => p.mm < 0.5 && p.radar >= 5).length,
    byDistrict: [...byDistrict.values()].map((d) => ({ ...d, gauge: d.gauge / d.n, radar: d.radar / d.n })),
  };
}

// ---- Screen ----

const BANDS = [
  [0.5, "#c6e6ff", "0.5"],
  [2, "#7cc4ff", "2"],
  [5, "#2b8cff", "5"],
  [10, "#1b5fd1", "10"],
  [20, "#3a2fb8", "20"],
  [35, "#7d1fb0", "35"],
  [65, "#c2185b", "65"],
  [115, "#ff6d00", "115+ mm"],
];
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const BAND_RGB = BANDS.map(([, c]) => hexRgb(c));
const fmt = (v) => (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10).toString();
const HOURS_KEY = "myweather.radarrain.hours";

const $ = (id) => document.getElementById(id);
let L = null;
let map = null;
let overlay = null;
let overlayUrl = "";
let gaugeLayer = null;
let shown = null; // { mm, hours }
let run = 0;

function say(text, error = false) {
  const s = $("rr-status");
  s.textContent = text;
  s.className = error ? "status error" : "status";
}

async function totalsImage(mm) {
  const rows = mercatorRows(COARSE);
  const c = document.createElement("canvas");
  c.width = CW;
  c.height = CH;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(CW, CH);
  for (let j = 0; j < CH; j++)
    for (let x = 0; x < CW; x++) {
      const v = mm[rows[j] * CW + x];
      if (v < BANDS[0][0]) continue;
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

function ensureMap() {
  if (map) return;
  const box = $("rr-map");
  map = L.map(box, { zoomControl: true }).setView([11.0, 78.5], 6);
  addTiles(L, map, box);
  map.on("click", (e) => {
    if (!shown) return;
    const c = cellOf(e.latlng.lat, e.latlng.lng);
    if (c < 0) return;
    L.popup()
      .setLatLng(e.latlng)
      .setContent(`About ${fmt(shown.mm[c])} mm in the last ${shown.hours} h (radar estimate)`)
      .openOn(map);
  });
}

function renderDistricts(d) {
  const rows = Object.entries(d).sort((a, b) => b[1].mean - a[1].mean);
  const top = Math.max(1, ...rows.map(([, v]) => v.max));
  $("rr-districts").replaceChildren(
    ...rows.map(([name, v]) => {
      const li = document.createElement("li");
      li.className = "rank-row rr-row";
      li.innerHTML = '<span class="rank-name"></span><span class="rank-val"></span><span class="rank-bar"><i></i></span>';
      li.querySelector(".rank-name").textContent = name;
      li.querySelector(".rank-val").textContent = `${fmt(v.mean)} mm · max ${fmt(v.max)}`;
      const bar = li.querySelector("i");
      bar.style.width = `${Math.min(100, (v.mean / top) * 100)}%`;
      bar.style.background = "#2b8cff";
      return li;
    })
  );
}

function renderCheck(c, hours) {
  const sum = $("rr-check-sum");
  const list = $("rr-check-list");
  gaugeLayer?.remove();
  gaugeLayer = null;
  if (!c) {
    sum.textContent = "No TN-SMART gauge readings for the last hours yet.";
    list.replaceChildren();
    return;
  }
  const endTxt = ist(new Date(c.end));
  if (c.have < c.want * 0.6) {
    sum.textContent = `The radar steps kept cover only ${c.have} of the ${c.want} ten-minute steps to ${endTxt}, so there's nothing fair to compare yet. Open this screen again in a while.`;
    list.replaceChildren();
    return;
  }
  const pct = c.ratio === null ? null : Math.round(c.ratio * 100);
  sum.textContent =
    (c.wetGauges
      ? `Over the ${hours} h to ${endTxt}, ${c.wetGauges} gauges caught 1 mm or more. Where they did, the radar read ${pct}% of the gauges' rain` +
        (pct > 130 ? " (reads high)." : pct < 70 ? " (reads low)." : " (about right).")
      : `No gauge caught 1 mm or more in the ${hours} h to ${endTxt}.`) +
    ` Missed by the radar (gauge 5 mm+, radar under 1): ${c.missed}. Radar rain with dry gauges (radar 5 mm+, gauge under 0.5): ${c.falseRain}.` +
    (c.have < c.want ? ` Radar seen for ${c.have} of ${c.want} steps.` : "");
  const rows = c.byDistrict.filter((d) => d.n >= 2).sort((a, b) => b.gauge - a.gauge);
  list.replaceChildren(
    ...rows.map((d) => {
      const li = document.createElement("li");
      li.className = "rank-row";
      const ratio = d.gauge ? d.radar / d.gauge : null;
      li.innerHTML = '<span class="rank-name"></span><span class="rank-val"></span>';
      li.querySelector(".rank-name").textContent = `${d.district} (${d.n} gauges)`;
      li.querySelector(".rank-val").textContent = `gauge ${fmt(d.gauge)} · radar ${fmt(d.radar)} mm${ratio !== null ? ` · ${Math.round(ratio * 100)}%` : ""}`;
      li.classList.add(ratio > 1.3 ? "rr-high" : ratio < 0.7 ? "rr-low" : "rr-ok");
      return li;
    })
  );
  if (!map) return;
  // Gauges with rain on either side: blue = radar low, red = radar high.
  gaugeLayer = L.layerGroup(
    c.pairs
      .filter((p) => p.mm >= 1 || p.radar >= 1)
      .map((p) => {
        const r = (p.radar + 0.5) / (p.mm + 0.5);
        const colour = r > 1.5 ? "#e53935" : r < 0.67 ? "#1e88e5" : "#43a047";
        return L.circleMarker([p.lat, p.lon], { radius: 4, weight: 1, color: "#222", fillColor: colour, fillOpacity: 0.9 }).bindPopup(
          `${p.name} (${p.district})<br>Gauge ${fmt(p.mm)} mm · radar ${fmt(p.radar)} mm`
        );
      })
  );
  if ($("rr-gauges").checked) gaugeLayer.addTo(map);
}

async function load(force = false) {
  const me = ++run;
  const hours = Number($("rr-hours").value);
  try {
    await buildMosaic({ force, onStep: (t) => me === run && say(t) });
    if (me !== run) return;
    const t = await radarTotals(hours);
    if (me !== run) return;
    shown = { mm: t.mm, hours };
    const url = await totalsImage(t.mm);
    if (map) {
      const b = [
        [GRID.lat1 - CH / COARSE.lat[2], GRID.lon0],
        [GRID.lat1, GRID.lon0 + CW / COARSE.lon[2]],
      ];
      if (!overlay) overlay = L.imageOverlay(url, b, { opacity: 0.8, interactive: false, className: "rr-layer" }).addTo(map);
      else overlay.setUrl(url);
      if (overlayUrl) URL.revokeObjectURL(overlayUrl);
      overlayUrl = url;
    }
    $("rr-when").textContent = `Radar rain, ${hours} h to ${ist(new Date(t.end))}`;
    say(
      t.have >= t.want
        ? `Radar rain over the last ${hours} h to ${ist(new Date(t.end))}. Tap the map for a spot.`
        : `Radar seen for ${t.have} of the ${t.want} ten-minute steps in the last ${hours} h, so totals may be low.` +
            (hours > 3 ? " One download covers 3 hours; the app keeps what it sees, so 6 hours fills in when you come back later." : "")
    );
    districtTotals(t.mm)
      .then((d) => me === run && renderDistricts(d))
      .catch((e) => ($("rr-districts").textContent = `Couldn't load the district outlines (${e.message}).`));
    $("rr-check-sum").textContent = "Reading the TN-SMART gauges…";
    radarVsGauges(Math.min(hours, 6))
      .then((c) => me === run && renderCheck(c, Math.min(hours, 6)))
      .catch((e) => ($("rr-check-sum").textContent = `Couldn't read the gauges (${e.message}).`));
  } catch (e) {
    if (me !== run) return;
    say(
      /Failed to fetch|NetworkError|Load failed/.test(e.message)
        ? "Couldn't read IMD's radar images. They can only be read inside the MyWeather app."
        : `Couldn't load the radars (${e.message}).`,
      true
    );
  }
}

export function initRadarRain() {
  const hours = $("rr-hours");
  try {
    const h = localStorage.getItem(HOURS_KEY);
    if (["1", "3", "6"].includes(h)) hours.value = h;
  } catch {}
  hours.addEventListener("change", () => {
    try {
      localStorage.setItem(HOURS_KEY, hours.value);
    } catch {}
    load();
  });
  $("rr-refresh").addEventListener("click", () => load(true));
  $("rr-gauges").addEventListener("change", () => {
    if (!gaugeLayer) return;
    if ($("rr-gauges").checked) gaugeLayer.addTo(map);
    else gaugeLayer.remove();
  });
  bindSaver($("rr-saver"), () => load());
  $("rr-legend").replaceChildren(
    ...BANDS.map(([, c, label]) => {
      const s = document.createElement("span");
      s.style.setProperty("--level", c);
      s.textContent = label;
      return s;
    })
  );
}

export async function showRadarRain() {
  try {
    L = await loadLeaflet();
    ensureMap();
    setTimeout(() => map.invalidateSize(), 0);
  } catch (e) {
    $("rr-map").textContent = `Couldn't open the map (${e.message}).`;
  }
  load();
}
