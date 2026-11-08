// Tamil Nadu radar mosaic: the rain from all five IMD radars that reach the
// state (Chennai, Karaikal, Thiruvananthapuram, Kochi and Sriharikota) laid on
// one map, for the Radar map's "Tamil Nadu" choice and the Nowcast screen.
//
// Each radar's echoes are lifted out of its pictures as on the Radar map (see
// js/radarmap.js). The radars draw rain in different colour scales (the same
// white is 30 dBZ at Thiruvananthapuram and 40 at Chennai), so each echo's
// colour is first read back to a reflectivity in dBZ against that radar's
// own colour bar, measured off its pictures (Nov 2026). Where two radars see
// the same spot, the stronger reading is kept, as IMD's own mosaics do.
//
// The radars don't scan at the same moments. The mosaic steps every 10
// minutes over the last 3 hours; at each step, each radar gives its latest
// scan from the 30 minutes before, moved on by that radar's storm motion for
// the minutes between its scan and the step (IMD posts some loops 20 minutes
// behind others). A radar with no scan that recent is left out of that step,
// and each step lists which scans went into it. Sriharikota publishes one
// scan an hour (its loop is 24 MB), so it joins only the steps within 30
// minutes after that scan; it has no loop, so it isn't moved.
//
// Storm motion is worked out per radar from its own loop (the frames of one
// radar line up exactly); the mosaic uses the nearest radar's motion, or the
// average of all of them, weighted by how much rain each sees.
import {
  RADARS,
  analyseLoop,
  readTime,
  cropRgb,
  size,
  step,
  yOfLat,
  datesOf,
  fetchBuffer,
  motion,
  loopUrl,
  mercatorRows,
  blur,
  rainMask,
} from "./radarmap.js";
import { radarImageUrl } from "./stations.js";
import { decodeGif } from "./gif.js";
import { distanceKm } from "./nowcast.js";
import { idbGet, idbPut } from "./idb.js";
import { savingData } from "./datasaver.js";

const TTL = 8 * 60 * 1000;
const STEP_MIN = 10;
const STEPS = 18; // 3 hours
const FRESH_MIN = 30;
export const MIN_DBZ = 20; // weaker echoes are left out (most radars don't show them)

// The mosaic grid: plain latitude/longitude, 1.2 km cells.
const BOX = { lon0: 74.6, lon1: 82.4, lat0: 7.2, lat1: 15.6 };
const CELL_KM = 1.2;
const PPD_LAT = 111.2 / CELL_KM;
const PPD_LON = (111.2 * Math.cos((11.4 * Math.PI) / 180)) / CELL_KM;
const W = Math.round((BOX.lon1 - BOX.lon0) * PPD_LON);
const H = Math.round((BOX.lat1 - BOX.lat0) * PPD_LAT);

/** The grid, for screens that work on the mosaic (radar rain totals). */
export const GRID = { ...BOX, W, H, PPD_LAT, PPD_LON, CELL_KM, STEP_MIN };

/** The mosaic as a Radar map "product" (same geometry fields). */
export const MOSAIC_PRODUCT = {
  code: "mosaic",
  mosaic: true,
  zoom: 6,
  name: "Max reflectivity · all 5 radars · loop",
  crop: [0, 0, W, H],
  lon: [BOX.lon0, 0, PPD_LON],
  lat: [BOX.lat1, 0, PPD_LAT],
  legend: "dbz",
  motion: true,
};

/** The mosaic as a Radar map "station". */
export const MOSAIC = {
  code: "tn",
  name: "Tamil Nadu (all 5 radars)",
  mosaic: true,
  lat: 11.2,
  lon: 78.6,
  vvp: "cni",
  products: [MOSAIC_PRODUCT],
};

// How far each radar reaches (km), from its pictures.
const RANGE = { cni: 250, kkl: 250, shr: 240, tvm: 240, koc: 250 };

// Each radar's colour bar: "rrggbb:dBZ", sampled down the bar (Nov 2026).
const BARS = {
  cni:
    "7e0038:61 9e0000:59 a10000:57 c50000:54 fd3d00:52 fe7100:50 fdba00:47 fde300:45 fdf5be:43 fdfdfd:40 84eefd:38 51cefd:36 18a0fd:33 0077fd:31 0033fd:29 0000c5:26 00009e:24",
  kkl:
    "d02760:60 d02747:59 d02734:58 d62e2b:57 e43e34:56 f24e3d:56 ff5d44:55 ff5b3a:54 ff5932:53 ff5827:52 ff5c27:50 ff6827:49 ff7d27:48 ff8c27:47 ff9c27:46 ffac27:46 ffbc27:45 ffcb27:44 ffd327:43 ffe127:42 ffea31:41 fff172:41 fff8ba:40 fffef4:39 dbf5ff:38 abe8ff:37 80ddff:36 63d0ff:36 53c3ff:35 45b7ff:34 3badff:33 33a1ff:32 2c95ff:31 278bff:31 2778ff:30 2765ff:29 2752fe:28 2744ef:27 2737e1:26 272ad4:26 3427c8:25 4427bd:24 5227b4:23 5827af:21",
  tvm: "c7004e:58 c70000:54 fe3e00:50 fe7200:46 febc00:42 fee500:38 fef7c0:34 fefefe:30 86f0fe:26 52d0fe:22 19a2fe:18 0078fe:14 0033fe:10 0000c7:6 39009f:2",
  koc:
    "520505:59 6a2325:57 a02223:55 ac110d:54 e70c07:53 fb0202:51 f79211:49 fd9307:47 fbf717:45 fefe04:43 fbfde5:41 e8e9e6:39 86ebfb:37 8eecf8:36 39b4f2:35 37b7fc:33 067ae9:31 027afc:29 0027d8:27 021ae3:25 0102a3:23 02019c:22 0f18ac:20",
  shr:
    "fe0500:59 fe1c00:58 fe3300:57 fe4600:56 fe5d00:55 fe7400:54 fe8700:53 fe9e00:52 feac00:50 feba00:50 fec600:49 fed70e:47 ffe039:46 fee55d:45 fee97a:44 fff09e:43 fef3bb:42 fef9de:41 fefefe:40 def6fe:39 baedfe:37 9de6fe:37 7addfe:35 5dd5fe:35 39ccfe:34 1bc5fe:33 01bafb:32 00a9f0:31 009ae8:30 0088dc:29 0079d4:28 0069ca:27 005ac1:26 0047b5:24 0037ab:24 0028a2:22 001698:22 00078f:20",
};
const PALETTES = Object.fromEntries(
  Object.entries(BARS).map(([code, text]) => [
    code,
    text.split(" ").map((e) => {
      const [hex, dbz] = e.split(":");
      return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), Number(dbz)];
    }),
  ])
);

// Colour → dBZ against a radar's bar; 0 when no bar colour is near.
function classifier(code, maxDist) {
  const pal = PALETTES[code];
  const memo = new Map();
  const lim = maxDist * maxDist;
  return (r, g, b) => {
    const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
    let v = memo.get(key);
    if (v !== undefined) return v;
    let best = Infinity;
    v = 0;
    for (const [pr, pg, pb, dbz] of pal) {
      const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
      if (d < best) {
        best = d;
        v = dbz;
      }
    }
    if (best > lim) v = 0;
    memo.set(key, v);
    return v;
  };
}

// The colours the mosaic is drawn in, by dBZ.
export const DBZ_BANDS = [
  [20, "#1d2bb0", "20"],
  [25, "#0b5cf0", "25"],
  [30, "#1ea2ff", "30"],
  [35, "#7fdcff", "35"],
  [40, "#fff7b0", "40"],
  [45, "#ffcf00", "45"],
  [50, "#ff7a00", "50"],
  [55, "#e10000", "55"],
  [60, "#8b0045", "60+ dBZ"],
];
const BAND_RGB = DBZ_BANDS.map(([, hex]) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
const bandOf = (dbz) => {
  let k = 0;
  while (k + 1 < DBZ_BANDS.length && dbz >= DBZ_BANDS[k + 1][0]) k++;
  return k;
};

// ---- One radar ----

// dBZ of each rain pixel of a loop frame: the average colour of the rain
// pixels around it (IMD's GIFs are dithered), map-coloured pixels left out.
function loopDbz(rgb, mask, bg, w, h, classify) {
  const out = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const j = i + dy * w + dx;
          if (!mask[j]) continue;
          const k = j * 3;
          const d = (rgb[k] - bg[k]) ** 2 + (rgb[k + 1] - bg[k + 1]) ** 2 + (rgb[k + 2] - bg[k + 2]) ** 2;
          if (d < 900) continue; // this pixel shows the map
          r += rgb[k];
          g += rgb[k + 1];
          b += rgb[k + 2];
          n++;
        }
      if (!n) continue;
      const v = classify(r / n, g / n, b / n);
      if (v >= MIN_DBZ) out[i] = v;
    }
  return out;
}

// Sriharikota's picture is a smooth (not dithered) colour scale over a
// shaded-relief map, so rain is told by colour alone: pixels close to a bar
// colour, with others like them around (labels and lines are lone pixels).
// Its white (40 dBZ) is also the label boxes' colour, so white counts only
// inside rain.
function stillDbz(rgb, w, h, classify) {
  const raw = new Uint8Array(w * h);
  const white = new Uint8Array(w * h);
  for (let i = 0, k = 0; i < w * h; i++, k += 3) {
    const r = rgb[k];
    const g = rgb[k + 1];
    const b = rgb[k + 2];
    if (r > 245 && g > 245 && b > 245) {
      white[i] = 1;
      continue;
    }
    raw[i] = classify(r, g, b);
  }
  const out = new Uint8Array(w * h);
  for (let y = 3; y < h - 3; y++)
    for (let x = 3; x < w - 3; x++) {
      const i = y * w + x;
      let near = 0;
      for (const j of [i - w - 1, i - w, i - w + 1, i - 1, i + 1, i + w - 1, i + w, i + w + 1]) if (raw[j]) near++;
      if (raw[i] && near >= 3 && raw[i] >= MIN_DBZ) out[i] = raw[i];
      else if (white[i] && near >= 5) out[i] = 40;
    }
  return out;
}

// Mosaic cell → this radar's pixel, for the cells it reaches.
function lookup(r, p, w, h) {
  const cells = [];
  const src = [];
  const reach = RANGE[r.code] || 240;
  const s = step(p);
  for (let gy = 0; gy < H; gy++) {
    const lat = BOX.lat1 - (gy + 0.5) / PPD_LAT;
    if (Math.abs(lat - r.lat) * 111.2 > reach) continue;
    const sy = Math.round((yOfLat(p, lat) - p.crop[1]) / s);
    if (sy < 3 || sy >= h - 3) continue;
    for (let gx = 0; gx < W; gx++) {
      const lon = BOX.lon0 + (gx + 0.5) / PPD_LON;
      if (distanceKm([lat, lon], [r.lat, r.lon]) > reach) continue;
      const sx = Math.round(((lon - p.lon[0]) * p.lon[2] + p.lon[1] - p.crop[0]) / s);
      if (sx < 3 || sx >= w - 3) continue;
      cells.push(gy * W + gx);
      src.push(sy * w + sx);
    }
  }
  return { cells: Int32Array.from(cells), src: Int32Array.from(src) };
}

const mainProduct = (r) => r.products.find((x) => x.code === "caz");

// Data saver: a loop radar's latest picture against the bare map saved from
// its last full loop. null when there's no saved map yet.
async function stillLayer(r, buf, saved) {
  const p = mainProduct(r);
  const [w, h] = size(p);
  if (!saved || saved.w !== w || saved.h !== h) return null;
  let rgb = null;
  let minute = null;
  decodeFirst(buf, (rgba, width) => {
    minute = readTime(rgba, width, p);
    rgb = cropRgb(rgba, width, p);
  });
  const time = datesOf([minute])[0];
  if (!time) throw new Error("couldn't read the scan time");
  const mask = rainMask(blur(rgb, w, h), saved.bg, w, h);
  const dbz = loopDbz(rgb, mask, saved.bg, w, h, classifier(r.code, 60));
  const mo = await idbGet("misc", `motion.${r.code}`);
  const m = mo && Date.now() - mo.at < 2 * 3600 * 1000 ? mo.motion : null;
  let rain = 0;
  for (const v of mask) rain += v;
  return { r, frames: [{ time, dbz }], motion: m, motionAt: m ? mo.at : 0, lut: lookup(r, p, w, h), rain };
}

// { r, frames: [{ time, dbz }], motion, lut, rain (pixels in the last frame) }
async function radarLayer(r, buf, cancelled) {
  const p = mainProduct(r);
  // The still isn't dithered, so its colours must sit right on the bar (its
  // pale sea is close to the bar's palest blue).
  const classify = classifier(r.code, p.loop ? 60 : 18);
  if (p.loop) {
    const a = await analyseLoop(r, p, cancelled, () => {}, buf);
    if (!a) return null;
    const frames = [];
    a.rgbs.forEach((rgb, i) => {
      if (!a.times[i]) return;
      frames.push({ time: a.times[i], dbz: loopDbz(rgb, a.masks[i], a.bg, a.w, a.h, classify) });
    });
    if (!frames.length) throw new Error("couldn't read the scan times");
    const m = p.motion ? motion(a.masks, a.times, p, a.w, a.h) : null;
    // Kept for data-saver mode: the bare map and the motion.
    idbPut("bg", r.code, { bg: a.bg, w: a.w, h: a.h, at: Date.now() });
    idbPut("misc", `motion.${r.code}`, { motion: m, at: Date.now() });
    const lastMask = a.masks[a.masks.length - 1];
    let rain = 0;
    for (const v of lastMask) rain += v;
    return { r, frames, motion: m, lut: lookup(r, p, a.w, a.h), rain };
  }
  // A single picture.
  let rgb = null;
  let minute = null;
  decodeFirst(buf, (rgba, width) => {
    minute = readTime(rgba, width, p);
    rgb = cropRgb(rgba, width, p);
  });
  const time = datesOf([minute])[0];
  if (!time) throw new Error("couldn't read the scan time");
  const [w, h] = size(p);
  return { r, frames: [{ time, dbz: stillDbz(rgb, w, h, classify) }], motion: null, lut: lookup(r, p, w, h), rain: 0 };
}

function decodeFirst(buf, cb) {
  decodeGif(buf, (rgba, width, height, i) => {
    if (!i) cb(rgba, width);
  });
}

// ---- Whole mosaic ----

// Motion near a place: the nearest radar (within its reach) that could follow
// the rain, else all of them together.
function motionNear(layers, all, lat, lon) {
  const near = layers
    .filter((l) => l.motion)
    .map((l) => ({ l, d: distanceKm([lat, lon], [l.r.lat, l.r.lon]) }))
    .filter(({ l, d }) => d <= (RANGE[l.r.code] || 240))
    .sort((a, b) => a.d - b.d)[0];
  return near ? near.l.motion : all;
}

// Weighted by the rain each radar sees.
function combinedMotion(layers) {
  const ms = layers.filter((l) => l.motion);
  if (!ms.length) return null;
  let wsum = 0;
  let vx = 0;
  let vy = 0;
  let pairs = 0;
  let agree = 0;
  for (const l of ms) {
    const wgt = Math.max(1, l.rain);
    vx += l.motion.vx * wgt;
    vy += l.motion.vy * wgt;
    wsum += wgt;
    pairs += l.motion.pairs;
    agree += l.motion.agree;
  }
  vx /= wsum;
  vy /= wsum;
  const speed = Math.hypot(vx, vy);
  // Radars that point different ways make the mean shaky.
  const off = ms.filter((l) => Math.hypot(l.motion.vx - vx, l.motion.vy - vy) > Math.max(8, speed * 0.4)).length;
  return {
    vx,
    vy,
    speed,
    toward: ((Math.atan2(vx, vy) * 180) / Math.PI + 360) % 360,
    pairs,
    agree: off ? 0 : agree,
    radars: ms.length,
  };
}

function compose(layers) {
  const latest = Math.max(...layers.map((l) => l.frames[l.frames.length - 1].time.valueOf()));
  const end = Math.floor(latest / 60000) * 60000;
  const frames = [];
  for (let k = STEPS - 1; k >= 0; k--) {
    const t = end - k * STEP_MIN * 60000;
    const dbz = new Uint8Array(W * H);
    const scans = [];
    for (const l of layers) {
      // The latest scan at or before this step (2 minutes' grace), if recent.
      let f = null;
      for (const fr of l.frames) if (fr.time.valueOf() <= t + 2 * 60000) f = fr;
      if (!f || t - f.time.valueOf() > FRESH_MIN * 60000) {
        scans.push({ name: l.r.name, time: null });
        continue;
      }
      // Older scans are carried forward along the rain's motion.
      const age = (t - f.time.valueOf()) / 60000;
      const m = l.motion;
      const sx = m && age >= 2 ? Math.round((m.vx * age) / 60 / CELL_KM) : 0;
      const sy = m && age >= 2 ? Math.round((-m.vy * age) / 60 / CELL_KM) : 0;
      scans.push({ name: l.r.name, time: f.time, moved: sx || sy ? Math.round(age) : 0 });
      const { cells, src } = l.lut;
      const v = f.dbz;
      for (let i = 0; i < cells.length; i++) {
        const x = v[src[i]];
        if (!x) continue;
        let c = cells[i];
        if (sx || sy) {
          const gx = (c % W) + sx;
          const gy = ((c / W) | 0) + sy;
          if (gx < 0 || gy < 0 || gx >= W || gy >= H) continue;
          c = gy * W + gx;
        }
        if (x > dbz[c]) dbz[c] = x;
      }
    }
    if (scans.some((s) => s.time)) frames.push({ time: new Date(t), dbz, scans });
  }
  return frames;
}

/** Rain mask (1 = at least MIN_DBZ) of a mosaic frame. */
export function maskOf(dbz) {
  const m = new Uint8Array(dbz.length);
  for (let i = 0; i < dbz.length; i++) m[i] = dbz[i] ? 1 : 0;
  return m;
}

/** A frame as an image for the web map (object URL), rows re-spaced for Mercator. */
export async function frameImage(dbz) {
  const rows = mercatorRows(MOSAIC_PRODUCT);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(W, H);
  const d = img.data;
  for (let j = 0; j < H; j++) {
    const sy = rows[j];
    for (let x = 0; x < W; x++) {
      const v = dbz[sy * W + x];
      if (!v) continue;
      const [r, g, b] = BAND_RGB[bandOf(v)];
      const o = (j * W + x) * 4;
      d[o] = r;
      d[o + 1] = g;
      d[o + 2] = b;
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const blob = await new Promise((res) => c.toBlob(res, "image/png"));
  return URL.createObjectURL(blob);
}

/** The radars in the mosaic, for markers and range rings. */
export const MOSAIC_RADARS = () => RADARS.map((r) => ({ r, km: RANGE[r.code] || 240 }));

let cache = null; // { at, promise, saver }
const listeners = [];

/** fn(mosaic) runs after every new build (radar rain totals keep its steps). */
export const onMosaic = (fn) => listeners.push(fn);

/**
 * Downloads all five radars and builds the mosaic, or reuses one under 8
 * minutes old. onStep(text) reports progress. With the data saver on (see
 * js/datasaver.js), latest pictures are read instead of loops.
 * Resolves to { frames: [{ time, dbz, scans }], w, h, p, layers: [{ name,
 * time, motion, error }], motion, motionAt(lat, lon), grid(frame) }.
 */
export function buildMosaic({ force = false, onStep = () => {} } = {}) {
  const saver = savingData();
  // A full build serves the saver too; a saver build doesn't serve a full one.
  if (!force && cache && Date.now() - cache.at < TTL && (saver || !cache.saver)) return cache.promise;
  const promise = build(onStep, saver);
  cache = { at: Date.now(), promise, saver };
  promise.then((m) => listeners.forEach((fn) => fn(m))).catch(() => {});
  promise.catch(() => {
    if (cache?.promise === promise) cache = null;
  });
  return promise;
}

export const mosaicCached = () => (cache && Date.now() - cache.at < TTL ? cache.promise : null);

async function build(onStep, saver) {
  // Data saver: pictures for the radars whose bare map is saved; loops for the rest.
  const saved = saver ? await Promise.all(RADARS.map((r) => (mainProduct(r).loop ? idbGet("bg", r.code) : null))) : [];
  const still = (i) => !mainProduct(RADARS[i]).loop || (saver && !!saved[i]);
  const needLoops = RADARS.filter((r, i) => !still(i)).length;
  onStep(
    saver
      ? needLoops
        ? `Data saver: downloading latest pictures, plus ${needLoops} loop${needLoops > 1 ? "s" : ""} once to learn the map…`
        : "Data saver: downloading the latest radar pictures (about 0.8 MB)…"
      : "Downloading the five radars (about 16 MB)…"
  );
  const bufs = await Promise.all(
    RADARS.map((r, i) => {
      const p = mainProduct(r);
      return fetchBuffer(still(i) ? radarImageUrl(r.code, p.code) : loopUrl(r, p)).catch((e) => e);
    })
  );
  const layers = [];
  const status = [];
  for (let i = 0; i < RADARS.length; i++) {
    const r = RADARS[i];
    onStep(`Finding the rain: ${r.name} (${i + 1} of ${RADARS.length})…`);
    await new Promise((res) => setTimeout(res, 20)); // let the message paint
    if (bufs[i] instanceof Error) {
      status.push({ name: r.name, error: bufs[i].message });
      continue;
    }
    try {
      const l = still(i) && mainProduct(r).loop ? await stillLayer(r, bufs[i], saved[i]) : await radarLayer(r, bufs[i], () => false);
      if (!l) throw new Error("its saved map is out of date; turn the data saver off once");
      bufs[i] = null;
      layers.push(l);
      status.push({ name: r.name, time: l.frames[l.frames.length - 1].time, motion: l.motion, still: l.frames.length === 1, motionAt: l.motionAt || 0 });
    } catch (e) {
      status.push({ name: r.name, error: e.message });
    }
  }
  if (!layers.length) {
    const err = status.find((s) => s.error)?.error || "no radar";
    throw new Error(err);
  }
  onStep("Putting the radars together…");
  await new Promise((res) => setTimeout(res, 20));
  const frames = compose(layers);
  const all = combinedMotion(layers);
  // Keep only what the motion needs; the per-radar frames can go.
  const slim = layers.map((l) => ({ r: l.r, motion: l.motion, rain: l.rain }));
  const grid = (frame) => ({
    mask: maskOf(frame.dbz),
    w: W,
    h: H,
    kmPerPx: CELL_KM,
    toPx: (lat, lon) => [(lon - BOX.lon0) * PPD_LON - 0.5, (BOX.lat1 - lat) * PPD_LAT - 0.5],
  });
  return {
    frames,
    w: W,
    h: H,
    p: MOSAIC_PRODUCT,
    layers: status,
    motion: all,
    motionAt: (lat, lon) => motionNear(slim, all, lat, lon),
    grid,
    saver,
    at: Date.now(),
  };
}
