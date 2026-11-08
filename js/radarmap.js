// Radar map (#radarmap): IMD radar echoes laid on OpenStreetMap, as
// switchable layers, with IMD's 3-hour loop and the way the rain is moving.
// Chennai has five layers; Karaikal, Thiruvananthapuram and Kochi their MAX Z
// loop; Sriharikota its latest MAX Z picture.
//
// IMD publishes finished pictures, not data: each GIF has the map, district
// lines, range rings and labels drawn in under the echoes. To lift the echoes
// out, every frame of a loop is blurred a little (the GIFs are dithered) and
// compared with the per-pixel median of all frames. Rain moves between
// frames, so the median is the bare map; whatever differs from it is rain.
// Products without a loop are shown as the whole picture, see-through.
//
// The plots are drawn on a plain latitude/longitude grid or in kilometres
// around the radar; either way a degree is a fixed number of pixels, measured
// on each station's pictures (Nov 2026). Rows are re-spaced for the web map's
// Mercator projection so the echoes line up with the coast.
//
// Movement: the echoes of each pair of frames are matched by sliding one over
// the other; the best fit's shift over the time between frames is a speed.
// The frame times are read off the picture's title with digit templates.
import { loadLeaflet, isDark } from "./stationmap.js";
import { decodeGif } from "./gif.js";
import { IMD_RADAR_BASE, radarImageUrl } from "./stations.js";
import { routeParams } from "./route.js";
import { nowcastAt, headline, saveNowcast, distanceKm } from "./nowcast.js";

const STATION_KEY = "myweather.radarmap.station";
const PRODUCT_KEY = "myweather.radarmap.product";
const OPACITY_KEY = "myweather.radarmap.opacity";
const TTL = 8 * 60 * 1000;

// Each radar's plots, measured on its own pictures (Nov 2026); each station
// draws its pictures differently.
// crop: the plot inside the GIF [left, top, right, bottom].
// lon/lat: [degree, pixel x/y of that degree, pixels per degree]. For plots
//   drawn in kilometres around the radar, the radar's own position and pixel.
// scale: read every n-th pixel (very large pictures).
// time: where the "HH:MM" UTC time is printed [left, top, right (null: the
//   picture's edge), bottom], and which digit shapes it uses.
const km = (pxPerKm, lat) => [pxPerKm * 111.2, pxPerKm * 111.2 * Math.cos((lat * Math.PI) / 180)];
const [KKL_LAT, KKL_LON] = [10.92, 79.84];
const [TVM_LAT, TVM_LON] = [8.5374, 76.8657];
export const RADARS = [
  {
    code: "cni",
    name: "Chennai",
    lat: 13.0667,
    lon: 80.2833, // DWR Chennai, Port Trust building
    products: [
      {
        code: "caz",
        zoom: 8,
        name: "Max reflectivity (MAX Z) · 250 km · loop",
        loop: "MAXZ",
        crop: [0, 200, 500, 700],
        lon: [80, 218, 108.0],
        lat: [13, 457, 111.0],
        time: { box: [500, 30, null, 48] },
        legend: "z",
        motion: true,
      },
      {
        code: "sri",
        zoom: 9,
        name: "Rain rate (SRI) · 100 km · loop",
        loop: "SRI",
        crop: [0, 0, 600, 600],
        lon: [80, 221, 271.0],
        lat: [13, 319, 277.5],
        time: { box: [600, 30, null, 48] },
        legend: "rate",
        motion: true,
      },
      {
        code: "ppi",
        zoom: 8,
        name: "Reflectivity (PPI Z) · 150 km · picture",
        crop: [0, 0, 800, 800],
        lon: [80, 316, 288.5],
        lat: [13, 420, 296.0],
        time: { box: [800, 30, null, 48] },
        legend: "z",
      },
      {
        code: "ppz",
        zoom: 7,
        name: "Reflectivity (PPI Z) · 500 km · picture",
        crop: [0, 0, 800, 800],
        lon: [80, 378, 72.75],
        lat: [13, 404, 74.0],
        time: { box: [800, 30, null, 48] },
        legend: "z",
      },
      {
        code: "ppv",
        zoom: 8,
        name: "Radial wind (PPI V) · 250 km · picture",
        crop: [0, 0, 600, 600],
        lon: [80, 262, 130.0],
        lat: [13, 308, 133.25],
        time: { box: [600, 30, null, 48] },
        legend: "v",
      },
    ],
  },
  {
    code: "kkl",
    name: "Karaikal",
    lat: KKL_LAT,
    lon: KKL_LON,
    products: [
      {
        code: "caz",
        zoom: 7,
        name: "Max reflectivity (MAX Z) · 250 km · loop",
        loop: "MAXZ",
        crop: [0, 200, 520, 720],
        lat: [KKL_LAT, 460, km(1.04, KKL_LAT)[0]],
        lon: [KKL_LON, 260, km(1.04, KKL_LAT)[1]],
        time: { box: [724, 222, 880, 246], font: "helvetica" },
        legend: "z",
        motion: true,
      },
    ],
  },
  {
    code: "shr",
    name: "Sriharikota",
    lat: 13.6645,
    lon: 80.2274,
    products: [
      {
        // The loop is 24 MB with one scan an hour, so only the latest picture.
        code: "caz",
        zoom: 7,
        name: "Max reflectivity (MAX Z) · 240 km · picture",
        crop: [58, 631, 1856, 2429],
        scale: 3,
        lon: [80, 866, 401.6],
        lat: [13.5, 1596, 416.0],
        time: { box: [2485, 445, 2700, 482] },
        legend: "z",
      },
    ],
  },
  {
    code: "tvm",
    name: "Thiruvananthapuram",
    lat: TVM_LAT,
    lon: TVM_LON,
    products: [
      {
        code: "caz",
        zoom: 7,
        name: "Max reflectivity (MAX Z) · 240 km · loop",
        loop: "MAXZ",
        crop: [43, 181, 557, 695],
        lat: [TVM_LAT, 438, km(1.07, TVM_LAT)[0]],
        lon: [TVM_LON, 300, km(1.07, TVM_LAT)[1]],
        time: { box: [236, 14, 330, 38] },
        legend: "z",
        motion: true,
      },
    ],
  },
  {
    code: "koc",
    name: "Kochi",
    lat: 9.92,
    lon: 76.28,
    products: [
      {
        code: "caz",
        zoom: 7,
        name: "Max reflectivity (MAX Z) · 250 km · loop",
        loop: "MAXZ",
        crop: [100, 300, 700, 900],
        lon: [74, 100, 131.75],
        lat: [12, 322, 133.75],
        time: { box: [772, 192, 910, 216] },
        legend: "z",
        motion: true,
      },
    ],
  },
];

const LEGENDS = {
  z: [
    ["#0000cc", "Light"],
    ["#3399ff", "Moderate"],
    ["#ffffcc", "Heavy"],
    ["#ffcc00", "Very heavy"],
    ["#ff3300", "Intense"],
    ["#990000", "Hail likely"],
  ],
  rate: [
    ["#0000cc", "< 1 mm/h"],
    ["#33ccff", "1–3"],
    ["#ffffcc", "3–6"],
    ["#ffcc00", "6–25"],
    ["#ff3300", "25–50"],
    ["#990000", "50+ mm/h"],
  ],
  v: [
    ["#0033ff", "Toward the radar"],
    ["#ffffff", "Still"],
    ["#ff3300", "Away from the radar"],
  ],
};

// 8×12 digit shapes (DejaVu Sans, IMD's title font), row by row.
const FONTS = {};
const DIGITS = {
  0: "001111000110011001000011110000111100001111000011110000111100001111000011010000110110011000111100",
  1: "011110001011100000111000001110000011100000111000001110000011100000111000001110000011100011111111",
  2: "011111001100011010000010000000110000001000000110000011000001100000110000011100000110000011111111",
  3: "001111000100011000000011000000110000011000111100000001100000001100000011000000111000011001111100",
  4: "000011100000111000010110001101100010011001100110110001101000011011111111000001100000011000000110",
  5: "011111100100000001000000010000000111110001000110000000110000001100000011000000111000011001111100",
  6: "000111100010001001000000110000001111110011100111110000111100001111000011010000110110001000111100",
  7: "111111110000001100000110000001100000010000001100000011000001100000011000000110000011000000110000",
  8: "001111000110011011000011110000110110011000111100011001101100001111000011110000110110011100111100",
  9: "001111000110011011000011110000111100001111000011011001110011111100000011000000100100011001111000",
};
FONTS.dejavu = DIGITS;
// Karaikal's bold Helvetica-like digits (0, 1, 2, 3, 5 read off its pictures,
// the rest from FreeSans Bold, which matched those five).
FONTS.helvetica = {
  "0": "001110000111111011000110110001101100001111000011110000111100001111000110110001100111111000111000",
  "1": "000011110011111111111111111011110000111100001111000011110000111100001111000011110000111100001111",
  "2": "001111000111111001100110011001100000011000001110000011000001100001110000011000001111111111111111",
  "3": "001111000111111011000011000000110000011000011100000111100000001111000011110000110111111000111100",
  "4": "000011100001111000011110001001100110011001100110110001101111111111111111000001100000011000000110",
  "5": "111111101111111011000000110000001101110011111110111001100000001100000011110001110111111000111100",
  "6": "000111000111111001100111111000001101110011111110111001111100001111000011011001100111111000111100",
  "7": "111111111111111100000111000001100000110000011000000110000001100000111000001100000011000001110000",
  "8": "001110000111111011100110110001100110011001111110111001101100001111000011111001110111111000111100",
  "9": "001110000111111011100110110001111100011111100111011111110011111100000110111001101111111000111000"
};


const $ = (id) => document.getElementById(id);
const status = $("rm-status");
const stationPick = $("rm-station");
const productPick = $("rm-product");
const box = $("rm-map");
const playBtn = $("rm-play");
const slider = $("rm-frame");
const timeLabel = $("rm-time");
const opacity = $("rm-opacity");
const motionBox = $("rm-motion");
const legendBox = $("rm-legend");
const note = $("rm-note");
const nowcastBox = $("rm-nowcast");
const cloudsPick = $("rm-clouds");
const cloudsNote = $("rm-clouds-note");

let L = null;
let map = null;
let tiles = null;
let overlay = null;
let arrow = null;
let marker = null;
let frames = []; // [{ url, time: Date|null }]
let shown = 0;
let timer = 0;
let loaded = { key: "", at: 0 };
let busy = 0; // load counter, so a late load doesn't overwrite a newer one

function say(text, error = false) {
  status.textContent = text;
  status.className = error ? "status error" : "status";
}

// ---- Geometry ----

const radar = () => RADARS.find((r) => r.code === stationPick.value) || RADARS[0];
const product = () => radar().products.find((p) => p.code === productPick.value) || radar().products[0];
const step = (p) => p.scale || 1;
const lonAt = (p, x) => p.lon[0] + (x - p.lon[1]) / p.lon[2];
const latAt = (p, y) => p.lat[0] - (y - p.lat[1]) / p.lat[2];
const yOfLat = (p, lat) => p.lat[1] - (lat - p.lat[0]) * p.lat[2];
const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const unmerc = (m) => (Math.atan(Math.exp(m)) * 360) / Math.PI - 90;
const kmPerPx = (p) => (111.2 / p.lat[2]) * step(p); // per output pixel

function bounds(p) {
  const [x0, y0] = p.crop;
  const [w, h] = size(p);
  const x1 = x0 + w * step(p);
  const y1 = y0 + h * step(p);
  return [
    [latAt(p, y1), lonAt(p, x0)],
    [latAt(p, y0), lonAt(p, x1)],
  ];
}

// Output row j of the Mercator-spaced image takes source row srcRow[j].
function mercatorRows(p) {
  const [, y0, , y1] = p.crop;
  const s = step(p);
  const h = Math.floor((y1 - y0) / s);
  const top = merc(latAt(p, y0));
  const bottom = merc(latAt(p, y0 + h * s));
  const rows = new Int32Array(h);
  for (let j = 0; j < h; j++) {
    const lat = unmerc(top + ((bottom - top) * (j + 0.5)) / h);
    rows[j] = Math.min(h - 1, Math.max(0, Math.round((yOfLat(p, lat) - y0) / s - 0.5)));
  }
  return rows;
}

// Size of the plot as read (after scale).
function size(p) {
  const [x0, y0, x1, y1] = p.crop;
  return [Math.floor((x1 - x0) / step(p)), Math.floor((y1 - y0) / step(p))];
}

// ---- Pixels ----

// The plot area of a frame as RGB.
function cropRgb(rgba, width, p) {
  const [x0, y0] = p.crop;
  const [w, h] = size(p);
  const n = step(p);
  const out = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = ((y * n + y0) * width + x * n + x0) * 4;
      const d = (y * w + x) * 3;
      out[d] = rgba[s];
      out[d + 1] = rgba[s + 1];
      out[d + 2] = rgba[s + 2];
    }
  }
  return out;
}

// 5×5 box blur of an RGB image, to even out the dithering.
function blur(rgb, w, h) {
  const r = 2;
  const tmp = new Uint16Array(w * h * 3);
  const out = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let x = -r; x <= r; x++) sum += rgb[(y * w + Math.min(w - 1, Math.max(0, x))) * 3 + c];
      for (let x = 0; x < w; x++) {
        tmp[(y * w + x) * 3 + c] = sum;
        sum += rgb[(y * w + Math.min(w - 1, x + r + 1)) * 3 + c] - rgb[(y * w + Math.max(0, x - r)) * 3 + c];
      }
    }
  }
  const n = (2 * r + 1) ** 2;
  for (let x = 0; x < w; x++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += tmp[(Math.min(h - 1, Math.max(0, y)) * w + x) * 3 + c];
      for (let y = 0; y < h; y++) {
        out[(y * w + x) * 3 + c] = sum / n;
        sum += tmp[(Math.min(h - 1, y + r + 1) * w + x) * 3 + c] - tmp[(Math.max(0, y - r) * w + x) * 3 + c];
      }
    }
  }
  return out;
}

// Per-pixel median of the blurred frames: the map without the rain.
function median(blurred) {
  const n = blurred.length;
  const len = blurred[0].length;
  const out = new Uint8Array(len);
  const v = new Uint8Array(n);
  for (let i = 0; i < len; i++) {
    for (let k = 0; k < n; k++) {
      // insertion sort while filling
      let x = blurred[k][i];
      let j = k;
      while (j > 0 && v[j - 1] > x) {
        v[j] = v[j - 1];
        j--;
      }
      v[j] = x;
    }
    out[i] = v[n >> 1];
  }
  return out;
}

// Rain pixels: far enough from the bare map, and not a lone speck.
function rainMask(blurred, bg, w, h) {
  const raw = new Uint8Array(w * h);
  for (let i = 0, k = 0; i < w * h; i++, k += 3) {
    const dr = blurred[k] - bg[k];
    const dg = blurred[k + 1] - bg[k + 1];
    const db = blurred[k + 2] - bg[k + 2];
    raw[i] = dr * dr + dg * dg + db * db > 1600 ? 1 : 0;
  }
  const mask = new Uint8Array(w * h);
  // Skip a 3-pixel margin: the plot's frame line blurs differently there.
  for (let y = 3; y < h - 3; y++) {
    for (let x = 3; x < w - 3; x++) {
      const i = y * w + x;
      if (!raw[i]) continue;
      const near = raw[i - w - 1] + raw[i - w] + raw[i - w + 1] + raw[i - 1] + raw[i + 1] + raw[i + w - 1] + raw[i + w] + raw[i + w + 1];
      mask[i] = near >= 2 ? 1 : 0;
    }
  }
  return mask;
}

// An image (object URL) of the frame: rain pixels in IMD's colours, or the
// whole picture when mask is null, re-spaced for Mercator.
async function toImage(rgb, mask, w, h, rows) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let j = 0; j < h; j++) {
    const sy = rows[j];
    for (let x = 0; x < w; x++) {
      const s = sy * w + x;
      if (mask && !mask[s]) continue;
      const o = (j * w + x) * 4;
      d[o] = rgb[s * 3];
      d[o + 1] = rgb[s * 3 + 1];
      d[o + 2] = rgb[s * 3 + 2];
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  return URL.createObjectURL(blob);
}

// ---- Frame times ("00:31 / 07-Nov-2026", UTC) ----

function readTime(rgba, width, p) {
  const [x0, y0, right, y1] = p.time.box;
  const x1 = Math.min(width, right ?? width);
  const digits = FONTS[p.time.font || "dejavu"];
  const w = x1 - x0;
  const h = y1 - y0;
  const dark = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const s = ((y + y0) * width + x + x0) * 4;
      dark[y * w + x] = rgba[s] + rgba[s + 1] + rgba[s + 2] < 384 ? 1 : 0;
    }
  // Glyphs are runs of columns with ink.
  const glyphs = [];
  let start = -1;
  for (let x = 0; x <= w; x++) {
    let ink = 0;
    if (x < w) for (let y = 0; y < h; y++) ink += dark[y * w + x];
    if (ink && start < 0) start = x;
    if (!ink && start >= 0) {
      glyphs.push([start, x]);
      start = -1;
    }
    if (glyphs.length >= 5) break;
  }
  if (glyphs.length < 5) return null;
  // Ink box of each glyph.
  const boxes = glyphs.map(([a, b]) => {
    let top = h;
    let bottom = -1;
    for (let y = 0; y < h; y++)
      for (let x = a; x < b; x++)
        if (dark[y * w + x]) {
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
    return [a, b, top, bottom];
  });
  const tallest = Math.max(...boxes.map(([, , t, b]) => b - t + 1));
  let text = "";
  for (const [a, b, top, bottom] of boxes) {
    const gh = bottom - top + 1;
    // The colon is the short one (and narrow).
    if (gh < tallest * 0.8 || b - a <= 3) {
      text += ":";
      continue;
    }
    // Scaled to 8×12.
    const gw = b - a;
    let bits = "";
    for (let gy = 0; gy < 12; gy++)
      for (let gx = 0; gx < 8; gx++) {
        const sx = a + Math.min(gw - 1, Math.floor(((gx + 0.5) * gw) / 8));
        const sy = top + Math.min(gh - 1, Math.floor(((gy + 0.5) * gh) / 12));
        bits += dark[sy * w + sx];
      }
    let best = "?";
    let bestD = Infinity;
    for (const [digit, t] of Object.entries(digits)) {
      let dd = 0;
      for (let i = 0; i < 96; i++) if (t[i] !== bits[i]) dd++;
      if (dd < bestD) {
        bestD = dd;
        best = digit;
      }
    }
    text += best;
  }
  const m = /^(\d\d):(\d\d)$/.exec(text);
  return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : null;
}

// Minutes after midnight UTC → Dates, the last one at or before now.
function datesOf(minutes) {
  const out = new Array(minutes.length).fill(null);
  const lastI = minutes.findLastIndex((m) => m != null);
  if (lastI < 0) return out;
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, minutes[lastI]));
  if (d - now > 10 * 60 * 1000) d.setUTCDate(d.getUTCDate() - 1);
  out[lastI] = d;
  for (let i = lastI - 1; i >= 0; i--) {
    if (minutes[i] == null) continue;
    const next = out.slice(i + 1).find(Boolean);
    let back = minutes.slice(i + 1).find((m) => m != null) - minutes[i];
    if (back < 0) back += 1440;
    out[i] = new Date(next - back * 60 * 1000);
  }
  return out;
}

const ist = (d) =>
  d
    ? d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }) +
      " IST"
    : "";

// ---- Movement ----

// The shift (in pixels) that best lays the echoes of a over those of b.
function bestShift(a, b, w, h, reach) {
  // Coarse: 4-pixel cells.
  const cw = Math.ceil(w / 4);
  const ch = Math.ceil(h / 4);
  const ca = new Uint8Array(cw * ch);
  const cb = new Uint8Array(cw * ch);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const c = (y >> 2) * cw + (x >> 2);
      if (a[i]) ca[c] = 1;
      if (b[i]) cb[c] = 1;
    }
  const pts = [];
  for (let i = 0; i < ca.length; i++) if (ca[i]) pts.push(i);
  const r = Math.max(2, Math.ceil(reach / 4));
  let best = [0, 0];
  let bestN = -1;
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      let n = 0;
      for (const i of pts) {
        const x = (i % cw) + dx;
        const y = ((i / cw) | 0) + dy;
        if (x >= 0 && y >= 0 && x < cw && y < ch && cb[y * cw + x]) n++;
      }
      if (n > bestN) {
        bestN = n;
        best = [dx * 4, dy * 4];
      }
    }
  // Fine: one pixel, around the coarse fit.
  const fine = [];
  for (let i = 0; i < a.length; i += 1) if (a[i]) fine.push(i);
  const step = Math.max(1, Math.floor(fine.length / 20000)); // cap the work in heavy rain
  let fineBest = best;
  bestN = -1;
  for (let dy = best[1] - 4; dy <= best[1] + 4; dy++)
    for (let dx = best[0] - 4; dx <= best[0] + 4; dx++) {
      let n = 0;
      for (let k = 0; k < fine.length; k += step) {
        const i = fine[k];
        const x = (i % w) + dx;
        const y = ((i / w) | 0) + dy;
        if (x >= 0 && y >= 0 && x < w && y < h && b[y * w + x]) n++;
      }
      if (n > bestN) {
        bestN = n;
        fineBest = [dx, dy];
      }
    }
  return { dx: fineBest[0], dy: fineBest[1], overlap: bestN * step, count: fine.length };
}

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const compass = (deg) => COMPASS[Math.round(deg / 22.5) % 16];
const COMPASS_WORDS = {
  N: "north", NNE: "north-northeast", NE: "northeast", ENE: "east-northeast", E: "east", ESE: "east-southeast",
  SE: "southeast", SSE: "south-southeast", S: "south", SSW: "south-southwest", SW: "southwest", WSW: "west-southwest",
  W: "west", WNW: "west-northwest", NW: "northwest", NNW: "north-northwest",
};

// From the last hour or so of frames: { speed km/h, toward degrees, pairs, agree }.
function motion(masks, times, p, w, h) {
  const km = kmPerPx(p);
  const vs = [];
  const last = masks.length - 1;
  for (let i = last; i > 0 && vs.length < 6; i--) {
    if (!times[i] || !times[i - 1]) continue;
    const mins = (times[i] - times[i - 1]) / 60000;
    if (mins < 4 || mins > 40) continue;
    const n = masks[i - 1].reduce((a, v) => a + v, 0);
    if (n < 150) continue; // too little rain to follow
    const reach = (100 * mins) / 60 / km; // up to 100 km/h
    const s = bestShift(masks[i - 1], masks[i], w, h, reach);
    if (s.overlap < s.count * 0.15) continue; // the echoes changed too much to match
    vs.push({ vx: (s.dx * km * 60) / mins, vy: (-s.dy * km * 60) / mins }); // km/h east, north
  }
  if (vs.length < 2) return null;
  const med = (arr) => {
    const s = [...arr].sort((a, b) => a - b);
    return s[s.length >> 1];
  };
  const vx = med(vs.map((v) => v.vx));
  const vy = med(vs.map((v) => v.vy));
  const speed = Math.hypot(vx, vy);
  const toward = ((Math.atan2(vx, vy) * 180) / Math.PI + 360) % 360;
  // How many pair estimates lie near the median.
  const agree = vs.filter((v) => Math.hypot(v.vx - vx, v.vy - vy) < Math.max(8, speed * 0.4)).length;
  return { speed, toward, vx, vy, pairs: vs.length, agree };
}

// Centre of the rain in the last frame, as [lat, lon].
function rainCentre(mask, p, w, h) {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (mask[y * w + x]) {
        sx += x;
        sy += y;
        n++;
      }
  if (!n) return null;
  return [latAt(p, (sy / n) * step(p) + p.crop[1]), lonAt(p, (sx / n) * step(p) + p.crop[0])];
}

// ---- Map ----

function setTiles() {
  box.classList.toggle("dark-tiles", isDark());
  if (tiles) return;
  tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 14,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · radar: IMD',
  }).addTo(map);
}

function ensureMap() {
  if (map) return;
  map = L.map(box).setView([radar().lat, radar().lon], 7);
  setTiles();
  // Tap the map: nowcast for that spot.
  map.on("click", (e) => {
    if (!last) return;
    try {
      localStorage.setItem(PLACE_KEY, JSON.stringify({ lat: e.latlng.lat, lon: e.latlng.lng }));
    } catch {}
    drawNowcast();
  });
  new MutationObserver(setTiles).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}

function placeMarker(r) {
  marker?.remove();
  marker = L.circleMarker([r.lat, r.lon], { radius: 4, color: "#111", weight: 2, fillColor: "#fff", fillOpacity: 1 })
    .bindTooltip(`${r.name} radar`)
    .addTo(map);
}

function renderLegend(p) {
  legendBox.replaceChildren(
    ...LEGENDS[p.legend].map(([c, label]) => {
      const s = document.createElement("span");
      s.style.setProperty("--level", c);
      s.textContent = label;
      return s;
    })
  );
}

function showFrame(i) {
  if (!frames.length) return;
  shown = Math.max(0, Math.min(frames.length - 1, i));
  slider.value = String(shown);
  overlay.setUrl(frames[shown].url);
  const t = frames[shown].time;
  timeLabel.textContent = t ? ist(t) : `${shown + 1} of ${frames.length}`;
}

function stop() {
  clearInterval(timer);
  timer = 0;
  playBtn.textContent = "▶";
  playBtn.setAttribute("aria-label", "Play the loop");
}

function play() {
  if (timer || frames.length < 2) return stop();
  playBtn.textContent = "❚❚";
  playBtn.setAttribute("aria-label", "Pause the loop");
  if (shown === frames.length - 1) showFrame(0);
  timer = setInterval(() => {
    // Hold a moment on the newest frame before starting again.
    if (shown === frames.length - 1) {
      showFrame(0);
      return;
    }
    showFrame(shown + 1);
  }, 600);
}

function clearFrames() {
  stop();
  for (const f of frames) URL.revokeObjectURL(f.url);
  frames = [];
}

function drawMotion(m, centre) {
  if (arrow) {
    arrow.remove();
    arrow = null;
  }
  if (!m) {
    motionBox.hidden = false;
    motionBox.textContent =
      "Storm movement: not enough rain in the last frames to follow, or it changed too much between frames.";
    return;
  }
  motionBox.hidden = false;
  const dir = compass(m.toward);
  const steady = m.agree >= Math.ceil(m.pairs * 0.6);
  motionBox.replaceChildren();
  const a = document.createElement("span");
  a.className = "rm-arrow";
  a.textContent = "➤";
  a.style.transform = `rotate(${m.toward - 90}deg)`;
  const t = document.createElement("span");
  t.textContent =
    m.speed < 5
      ? "Rain is almost still (under 5 km/h)."
      : `Rain is moving toward the ${COMPASS_WORDS[dir]} (${dir}) at about ${Math.round(m.speed)} km/h.` +
        (steady ? "" : " Estimates differ between frames, so take this loosely.");
  const s = document.createElement("small");
  s.textContent = ` Worked out by the app from the last ${m.pairs + 1} radar frames, not an IMD figure.`;
  motionBox.append(a, t, s);
  if (centre && m.speed >= 5) {
    // An arrow from the centre of the rain to where it would be in an hour.
    const end = [centre[0] + m.vy / 111.2, centre[1] + m.vx / (111.2 * Math.cos((centre[0] * Math.PI) / 180))];
    arrow = L.layerGroup([
      L.polyline([centre, end], { color: "#111", weight: 5, opacity: 0.6 }),
      L.polyline([centre, end], { color: "#fff", weight: 2.5 }),
      L.marker(end, {
        icon: L.divIcon({
          className: "",
          html: `<span class="rm-arrow" style="display:block;transform:translate(-50%,-50%) rotate(${m.toward - 90}deg);color:#fff;text-shadow:0 0 3px #000">➤</span>`,
          iconSize: null,
        }),
        interactive: false,
      }),
    ]).addTo(map);
  }
}

async function fetchBuffer(url) {
  const res = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.arrayBuffer();
}

// Downloads a loop and lifts the rain out of each frame:
// { rgbs, masks, times, w, h }, or null when cancelled() turns true.
async function analyseLoop(r, p, cancelled = () => false, onDecode = () => {}) {
  const [w, h] = size(p);
  const buf = await fetchBuffer(`${IMD_RADAR_BASE}animation/Converted/${r.code.toUpperCase()}_${p.loop}.gif`);
  if (cancelled()) return null;
  onDecode();
  await new Promise((res) => setTimeout(res, 30)); // let the message paint
  const rgbs = [];
  const minutes = [];
  decodeGif(buf, (rgba, width) => {
    const m = readTime(rgba, width, p);
    // IMD repeats a frame when a scan is missing; keep one of each time.
    if (minutes.length && m != null && m === minutes[minutes.length - 1]) return;
    minutes.push(m);
    rgbs.push(cropRgb(rgba, width, p));
  });
  const t0 = performance.now();
  const blurred = rgbs.map((rgb) => blur(rgb, w, h));
  const bg = median(blurred);
  const masks = blurred.map((bl) => rainMask(bl, bg, w, h));
  console.debug(`radar map: ${r.code}/${p.code} processed in ${Math.round(performance.now() - t0)} ms`);
  return { rgbs, masks, times: datesOf(minutes), w, h };
}

// A rain mask placed on the map, for the nowcast.
function gridOf(p, mask, w, h) {
  return {
    mask,
    w,
    h,
    kmPerPx: kmPerPx(p),
    toPx: (lat, lon) => [
      ((lon - p.lon[0]) * p.lon[2] + p.lon[1] - p.crop[0]) / step(p),
      (yOfLat(p, lat) - p.crop[1]) / step(p),
    ],
  };
}

// ---- Nowcast ----

const PLACE_KEY = "myweather.nowcast.place"; // a spot tapped on the map
const CHENNAI_PLACE = { lat: 13.08, lon: 80.27, name: "Chennai" };
let last = null; // { r, p, grid, motion, time } of the latest loop
let spotMarker = null;

const readJson = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
};

// The place to nowcast for: a spot tapped on the map, else the phone's
// position when Home's "Near you" is on, else Chennai.
export function nowcastPlace() {
  const picked = readJson(PLACE_KEY);
  if (picked && typeof picked.lat === "number") return { ...picked, name: "Picked spot", picked: true };
  const pos = readJson("myweather.home.gps") === true && readJson("myweather.home.pos");
  if (pos && typeof pos.lat === "number") return { lat: pos.lat, lon: pos.lon, name: "Your location" };
  return CHENNAI_PLACE;
}

function drawNowcast() {
  const box = nowcastBox;
  spotMarker?.remove();
  spotMarker = null;
  if (!last) {
    box.hidden = true;
    return;
  }
  const place = nowcastPlace();
  const res = nowcastAt(last.grid, last.motion, place.lat, place.lon);
  box.hidden = false;
  box.replaceChildren();
  const b = document.createElement("b");
  b.textContent = `${place.name}: `;
  const t = document.createElement("span");
  t.textContent = res.edge && res.eta === null && !res.raining && !res.nearest ? `outside ${last.r.name} radar's picture.` : headline(res);
  const small = document.createElement("small");
  small.textContent = place.picked
    ? " Tap the map to move the spot. "
    : " Tap the map for another spot. ";
  box.append(b, t, small);
  if (place.picked) {
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "linkish snap-skip";
    clear.textContent = "Back to " + (readJson("myweather.home.gps") === true ? "my location" : "Chennai");
    clear.addEventListener("click", () => {
      try {
        localStorage.removeItem(PLACE_KEY);
      } catch {}
      drawNowcast();
    });
    box.append(clear);
  }
  spotMarker = L.marker([place.lat, place.lon], {
    icon: L.divIcon({ className: "", html: '<span class="nc-pin">📍</span>', iconSize: null }),
    interactive: false,
  }).addTo(map);
  saveNowcast({ at: Date.now(), frame: last.time ? last.time.valueOf() : null, place: place.name, lat: place.lat, lon: place.lon, radar: last.r.name, result: res });
}

/**
 * Downloads the nearest radar's loop and nowcasts for a place, for Home:
 * the saved entry (see js/nowcast.js), or throws.
 */
export async function runNowcast(place = nowcastPlace()) {
  const near = RADARS.map((r) => ({ r, d: distanceKm([place.lat, place.lon], [r.lat, r.lon]) }))
    .filter(({ r }) => r.products.some((p) => p.loop && p.motion))
    .sort((a, b) => a.d - b.d)[0];
  if (!near || near.d > 230) throw new Error("No radar loop covers this place.");
  const r = near.r;
  const p = r.products.find((x) => x.loop && x.motion);
  const a = await analyseLoop(r, p);
  const m = motion(a.masks, a.times, p, a.w, a.h);
  const grid = gridOf(p, a.masks[a.masks.length - 1], a.w, a.h);
  const time = a.times[a.times.length - 1];
  const entry = { at: Date.now(), frame: time ? time.valueOf() : null, place: place.name, lat: place.lat, lon: place.lon, radar: r.name, result: nowcastAt(grid, m, place.lat, place.lon) };
  saveNowcast(entry);
  return entry;
}

// ---- Clouds (INSAT-3DS infrared, IMD's Asia sector picture) ----
//
// IMD's 3Dasiasec pictures are "L1C Mercator": longitude is linear (10° every
// 285.7 px, 80°E at x 1143) and rows are linear in Mercator y (equator at
// y 1912, 1870.33 px per unit), measured on its grid lines (Nov 2026). Rows
// above y 242 are the title. A Mercator picture lines up with the web map as
// it is, so only the region around Tamil Nadu is cut out and made see-through
// where the sky is clear: brighter (colder) cloud tops are more solid.
const SAT_URL = "https://mausam.imd.gov.in/Satellite/3Dasiasec_ir1.jpg";
const SAT = { lonX: (lon) => 28.5714 * lon - 1142.857, mercY: (m) => 1912.185 - 1870.33 * m, top: 242 };
const SAT_BOX = { lon0: 68, lon1: 96, lat0: 2, lat1: 24 };
const CLOUDS_KEY = "myweather.radarmap.clouds";
let clouds = null; // { layer, url, at }

export function cloudCrop() {
  const x0 = Math.round(SAT.lonX(SAT_BOX.lon0));
  const x1 = Math.round(SAT.lonX(SAT_BOX.lon1));
  const y0 = Math.max(SAT.top, Math.round(SAT.mercY(merc(SAT_BOX.lat1))));
  const y1 = Math.round(SAT.mercY(merc(SAT_BOX.lat0)));
  const lonOf = (x) => (x + 1142.857) / 28.5714;
  const latOf = (y) => unmerc((1912.185 - y) / 1870.33);
  return { x0, y0, w: x1 - x0, h: y1 - y0, bounds: [[latOf(y1), lonOf(x0)], [latOf(y0), lonOf(x1)]] };
}

// Grey infrared counts to see-through white cloud. IMD's borders are drawn in
// yellow-green; those pixels are dropped.
export function cloudPixels(d) {
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const v = (r + g + b) / 3;
    const line = g - Math.min(r, b) > 40 || r - b > 60;
    const a = line ? 0 : Math.max(0, Math.min(1, (v - 105) / 110));
    d[i] = d[i + 1] = 255;
    d[i + 2] = 255;
    d[i + 3] = Math.round(a * 220);
  }
}

// IMD's dotted 10° grid lines (one pixel wide) would show as thin cloud:
// each is replaced by the average of the pixels two away on either side.
export function removeGrid(img, c) {
  const { data, width: w, height: h } = img;
  const mix = (a, b, o) => {
    for (let k = 0; k < 4; k++) data[o + k] = (data[a + k] + data[b + k]) >> 1;
  };
  for (let lon = 70; lon <= 90; lon += 10) {
    const gx = Math.round(SAT.lonX(lon)) - c.x0;
    if (gx < 3 || gx > w - 4) continue;
    for (let y = 0; y < h; y++)
      for (let d = -1; d <= 1; d++) mix((y * w + gx - 2) * 4, (y * w + gx + 2) * 4, (y * w + gx + d) * 4);
  }
  for (let lat = 10; lat <= 20; lat += 10) {
    const gy = Math.round(SAT.mercY(merc(lat))) - c.y0;
    if (gy < 3 || gy > h - 4) continue;
    for (let x = 0; x < w; x++)
      for (let d = -1; d <= 1; d++) mix(((gy - 2) * w + x) * 4, ((gy + 2) * w + x) * 4, ((gy + d) * w + x) * 4);
  }
}

async function loadClouds() {
  const status = cloudsNote;
  if (clouds && Date.now() - clouds.at < TTL) {
    clouds.layer.addTo(map);
    return;
  }
  status.hidden = false;
  status.textContent = "Loading INSAT clouds (0.7 MB)…";
  try {
    const res = await fetch(`${SAT_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const modified = res.headers.get("last-modified");
    const bmp = await createImageBitmap(await res.blob());
    const c = cloudCrop();
    const canvas = document.createElement("canvas");
    canvas.width = c.w;
    canvas.height = c.h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, c.x0, c.y0, c.w, c.h, 0, 0, c.w, c.h);
    const img = ctx.getImageData(0, 0, c.w, c.h);
    removeGrid(img, c);
    cloudPixels(img.data);
    ctx.putImageData(img, 0, 0);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
    if (clouds) {
      clouds.layer.remove();
      URL.revokeObjectURL(clouds.url);
    }
    const url = URL.createObjectURL(blob);
    if (!map.getPane("clouds")) map.createPane("clouds").style.zIndex = 350;
    const layer = L.imageOverlay(url, c.bounds, { pane: "clouds", className: "rm-cloud-layer", interactive: false, opacity: 0.85 });
    clouds = { layer, url, at: Date.now() };
    if (cloudsPick.checked) layer.addTo(map);
    status.textContent = `Clouds: INSAT-3DS infrared${modified ? `, updated by IMD at ${ist(new Date(modified))}` : ""}. Whiter is higher, colder cloud.`;
  } catch (e) {
    status.textContent = /Failed to fetch|NetworkError|Load failed/.test(e.message)
      ? "Couldn't read IMD's satellite picture. It can only be read inside the MyWeather app."
      : `Couldn't load the clouds (${e.message}).`;
  }
}

function setClouds() {
  try {
    localStorage.setItem(CLOUDS_KEY, cloudsPick.checked ? "1" : "0");
  } catch {}
  if (cloudsPick.checked) loadClouds();
  else {
    clouds?.layer.remove();
    cloudsNote.hidden = true;
  }
}

async function load(force = false) {
  const r = radar();
  const p = product();
  const key = `${r.code}/${p.code}`;
  if (!force && loaded.key === key && Date.now() - loaded.at < TTL) {
    drawNowcast();
    return;
  }
  const run = ++busy;
  stop();
  renderLegend(p);
  const [w, h] = size(p);
  const rows = mercatorRows(p);
  const b = bounds(p);
  if (!overlay) overlay = L.imageOverlay("data:,", b, { opacity: opacity.value / 100, interactive: false }).addTo(map);
  overlay.setBounds(L.latLngBounds(b));
  if (loaded.key !== key) {
    map.setView([r.lat, r.lon], p.zoom);
    placeMarker(r);
    $("rm-vvp").src = radarImageUrl(r.code, "vp2");
    $("rm-vvp").alt = `IMD VVP wind profile for ${r.name}`;
  }
  try {
    if (p.loop) {
      say(`Downloading IMD's 3-hour loop for ${r.name} (1 to 5 MB)…`);
      const a = await analyseLoop(r, p, () => run !== busy, () => say("Finding the rain in each frame…"));
      if (!a) return;
      const { rgbs, masks, times, w, h } = a;
      const urls = await Promise.all(rgbs.map((rgb, i) => toImage(rgb, masks[i], w, h, rows)));
      if (run !== busy) return urls.forEach((u) => URL.revokeObjectURL(u));
      clearFrames();
      frames = urls.map((url, i) => ({ url, time: times[i] }));
      slider.max = String(frames.length - 1);
      slider.disabled = playBtn.disabled = frames.length < 2;
      showFrame(frames.length - 1);
      const m = p.motion ? motion(masks, times, p, w, h) : null;
      drawMotion(m, rainCentre(masks[masks.length - 1], p, w, h));
      last = { r, p, grid: gridOf(p, masks[masks.length - 1], w, h), motion: m, time: times[times.length - 1] };
      drawNowcast();
      const lastTime = times[times.length - 1];
      say(`Latest frame ${lastTime ? ist(lastTime) : ""} · ${frames.length} frames over 3 hours. Tap ▶ to play.`);
    } else {
      say("Loading the radar picture…");
      const buf = await fetchBuffer(radarImageUrl(r.code, p.code));
      if (run !== busy) return;
      let rgb = null;
      let minute = null;
      decodeGif(buf, (rgba, width, height, i) => {
        if (i) return;
        minute = readTime(rgba, width, p);
        rgb = cropRgb(rgba, width, p);
      });
      const url = await toImage(rgb, null, w, h, rows);
      if (run !== busy) return URL.revokeObjectURL(url);
      clearFrames();
      const time = datesOf([minute])[0];
      frames = [{ url, time }];
      slider.max = "0";
      slider.disabled = playBtn.disabled = true;
      showFrame(0);
      drawMotion(undefined);
      motionBox.hidden = true;
      last = null;
      drawNowcast();
      say(`Picture ${time ? ist(time) : ""}, with IMD's own map under it. Lower the opacity to see the streets.`);
    }
    loaded = { key, at: Date.now() };
    note.textContent =
      `IMD Doppler Weather Radar, ${r.name}. The rain` +
      " is lifted out of IMD's pictures by the app and placed by their" +
      " grid, so it can be off by a kilometre or two. Echoes that sit still for 3 hours (sea or" +
      " ground clutter) are dropped along with the map.";
  } catch (e) {
    if (run !== busy) return;
    say(
      /Failed to fetch|NetworkError|Load failed/.test(e.message)
        ? "Couldn't read IMD's radar images. They can only be read inside the MyWeather app; in a browser, IMD blocks this."
        : `Couldn't load the radar (${e.message}).`,
      true
    );
  }
}

function fillProducts() {
  const keep = productPick.value;
  productPick.replaceChildren(...radar().products.map((p) => new Option(p.name, p.code)));
  if (radar().products.some((p) => p.code === keep)) productPick.value = keep;
}

// Opens the map on a station, e.g. from Home's "near you" (#radarmap?station=kkl).
function stationFromRoute() {
  const want = routeParams().get("station");
  if (want && RADARS.some((r) => r.code === want) && want !== stationPick.value) {
    stationPick.value = want;
    fillProducts();
  }
}

export function initRadarMap() {
  stationPick.replaceChildren(...RADARS.map((r) => new Option(r.name, r.code)));
  try {
    const st = localStorage.getItem(STATION_KEY);
    if (RADARS.some((r) => r.code === st)) stationPick.value = st;
    fillProducts();
    const saved = localStorage.getItem(PRODUCT_KEY);
    if (radar().products.some((p) => p.code === saved)) productPick.value = saved;
    const o = Number(localStorage.getItem(OPACITY_KEY));
    if (o >= 20 && o <= 100) opacity.value = String(o);
  } catch {
    fillProducts();
  }
  stationPick.addEventListener("change", () => {
    try {
      localStorage.setItem(STATION_KEY, stationPick.value);
    } catch {}
    fillProducts();
    load();
  });
  productPick.addEventListener("change", () => {
    try {
      localStorage.setItem(PRODUCT_KEY, productPick.value);
    } catch {}
    load();
  });
  opacity.addEventListener("input", () => {
    overlay?.setOpacity(opacity.value / 100);
    try {
      localStorage.setItem(OPACITY_KEY, opacity.value);
    } catch {}
  });
  slider.addEventListener("input", () => {
    stop();
    showFrame(Number(slider.value));
  });
  playBtn.addEventListener("click", play);
  $("rm-refresh").addEventListener("click", () => {
    load(true);
    if (cloudsPick.checked) {
      if (clouds) clouds.at = 0;
      loadClouds();
    }
  });
  try {
    cloudsPick.checked = localStorage.getItem(CLOUDS_KEY) === "1";
  } catch {}
  cloudsPick.addEventListener("change", setClouds);
  slider.disabled = playBtn.disabled = true;
}

export async function showRadarMap() {
  try {
    L = await loadLeaflet();
  } catch (e) {
    say(`Couldn't open the map (${e.message}).`, true);
    return;
  }
  stationFromRoute();
  ensureMap();
  setTimeout(() => map.invalidateSize(), 0);
  load();
  if (cloudsPick.checked) loadClouds();
}

export function hideRadarMap() {
  stop();
}
