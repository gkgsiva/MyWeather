// Radar map (#radarmap): the Chennai radar's echoes laid on OpenStreetMap, as
// switchable layers, with IMD's 3-hour loop and the way the rain is moving.
//
// IMD publishes finished pictures, not data: each GIF has the map, district
// lines, range rings and labels drawn in under the echoes. To lift the echoes
// out, every frame of a loop is blurred a little (the GIFs are dithered) and
// compared with the per-pixel median of all frames. Rain moves between
// frames, so the median is the bare map; whatever differs from it is rain.
// Products without a loop are shown as the whole picture, see-through.
//
// The plots are drawn on a plain latitude/longitude grid. The grid lines were
// measured on each Chennai image (Nov 2026); rows are re-spaced for the web
// map's Mercator projection so the echoes line up with the coast.
//
// Movement: the echoes of each pair of frames are matched by sliding one over
// the other; the best fit's shift over the time between frames is a speed.
// The frame times are read off the picture's title with digit templates.
import { loadLeaflet, isDark } from "./stationmap.js";
import { decodeGif } from "./gif.js";
import { IMD_RADAR_BASE, radarImageUrl } from "./stations.js";

const RADAR = { code: "cni", name: "Chennai", lat: 13.0667, lon: 80.2833 }; // DWR Chennai, Port Trust building
const PRODUCT_KEY = "myweather.radarmap.product";
const OPACITY_KEY = "myweather.radarmap.opacity";
const TTL = 8 * 60 * 1000;

// crop: the plot inside the GIF [left, top, right, bottom].
// lon/lat: [degree, pixel x/y of that grid line, pixels per degree].
const PRODUCTS = [
  {
    code: "caz",
    zoom: 8,
    name: "Max reflectivity (MAX Z) · 250 km · loop",
    loop: "MAXZ",
    crop: [0, 200, 500, 700],
    lon: [80, 218, 108.0],
    lat: [13, 457, 111.0],
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
    legend: "z",
  },
  {
    code: "ppz",
    zoom: 7,
    name: "Reflectivity (PPI Z) · 500 km · picture",
    crop: [0, 0, 800, 800],
    lon: [80, 378, 72.75],
    lat: [13, 404, 74.0],
    legend: "z",
  },
  {
    code: "ppv",
    zoom: 8,
    name: "Radial wind (PPI V) · 250 km · picture",
    crop: [0, 0, 600, 600],
    lon: [80, 262, 130.0],
    lat: [13, 308, 133.25],
    legend: "v",
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

const $ = (id) => document.getElementById(id);
const status = $("rm-status");
const productPick = $("rm-product");
const box = $("rm-map");
const playBtn = $("rm-play");
const slider = $("rm-frame");
const timeLabel = $("rm-time");
const opacity = $("rm-opacity");
const motionBox = $("rm-motion");
const legendBox = $("rm-legend");
const note = $("rm-note");

let L = null;
let map = null;
let tiles = null;
let overlay = null;
let arrow = null;
let frames = []; // [{ url, time: Date|null }]
let shown = 0;
let timer = 0;
let loaded = { code: "", at: 0 };
let busy = 0; // load counter, so a late load doesn't overwrite a newer one

function say(text, error = false) {
  status.textContent = text;
  status.className = error ? "status error" : "status";
}

// ---- Geometry ----

const product = () => PRODUCTS.find((p) => p.code === productPick.value) || PRODUCTS[0];
const lonAt = (p, x) => p.lon[0] + (x - p.lon[1]) / p.lon[2];
const latAt = (p, y) => p.lat[0] - (y - p.lat[1]) / p.lat[2];
const yOfLat = (p, lat) => p.lat[1] - (lat - p.lat[0]) * p.lat[2];
const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const unmerc = (m) => (Math.atan(Math.exp(m)) * 360) / Math.PI - 90;
const kmPerPx = (p) => 111.2 / p.lat[2];

function bounds(p) {
  const [x0, y0, x1, y1] = p.crop;
  return [
    [latAt(p, y1), lonAt(p, x0)],
    [latAt(p, y0), lonAt(p, x1)],
  ];
}

// Output row j of the Mercator-spaced image takes source row srcRow[j].
function mercatorRows(p) {
  const [, y0, , y1] = p.crop;
  const h = y1 - y0;
  const top = merc(latAt(p, y0));
  const bottom = merc(latAt(p, y1));
  const rows = new Int32Array(h);
  for (let j = 0; j < h; j++) {
    const lat = unmerc(top + ((bottom - top) * (j + 0.5)) / h);
    rows[j] = Math.min(h - 1, Math.max(0, Math.round(yOfLat(p, lat) - y0 - 0.5)));
  }
  return rows;
}

// ---- Pixels ----

// The plot area of a frame as RGB.
function cropRgb(rgba, width, p) {
  const [x0, y0, x1, y1] = p.crop;
  const w = x1 - x0;
  const h = y1 - y0;
  const out = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = ((y + y0) * width + x + x0) * 4;
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
  const x0 = p.crop[2];
  const y0 = 30;
  const y1 = 48;
  const w = width - x0;
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
  let text = "";
  for (const [a, b] of glyphs) {
    if (b - a <= 3) {
      text += ":";
      continue;
    }
    // Ink box of the glyph, scaled to 8×12.
    let top = h;
    let bottom = -1;
    for (let y = 0; y < h; y++)
      for (let x = a; x < b; x++)
        if (dark[y * w + x]) {
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
    const gh = bottom - top + 1;
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
    for (const [digit, t] of Object.entries(DIGITS)) {
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
  return [latAt(p, sy / n + p.crop[1]), lonAt(p, sx / n + p.crop[0])];
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
  map = L.map(box).setView([RADAR.lat, RADAR.lon], 7);
  setTiles();
  new MutationObserver(setTiles).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  L.circleMarker([RADAR.lat, RADAR.lon], { radius: 4, color: "#111", weight: 2, fillColor: "#fff", fillOpacity: 1 })
    .bindTooltip("Chennai radar")
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

async function load(force = false) {
  const p = product();
  if (!force && loaded.code === p.code && Date.now() - loaded.at < TTL) return;
  const run = ++busy;
  stop();
  renderLegend(p);
  const [x0, y0, x1, y1] = p.crop;
  const w = x1 - x0;
  const h = y1 - y0;
  const rows = mercatorRows(p);
  const b = bounds(p);
  if (!overlay) overlay = L.imageOverlay("data:,", b, { opacity: opacity.value / 100, interactive: false }).addTo(map);
  overlay.setBounds(L.latLngBounds(b));
  if (loaded.code !== p.code) map.setView([RADAR.lat, RADAR.lon], p.zoom);
  try {
    if (p.loop) {
      say("Downloading IMD's 3-hour loop (about 5 MB)…");
      const buf = await fetchBuffer(`${IMD_RADAR_BASE}animation/Converted/${RADAR.code.toUpperCase()}_${p.loop}.gif`);
      if (run !== busy) return;
      say("Finding the rain in each frame…");
      await new Promise((r) => setTimeout(r, 30)); // let the message paint
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
      const times = datesOf(minutes);
      const urls = await Promise.all(rgbs.map((rgb, i) => toImage(rgb, masks[i], w, h, rows)));
      if (run !== busy) return urls.forEach((u) => URL.revokeObjectURL(u));
      clearFrames();
      frames = urls.map((url, i) => ({ url, time: times[i] }));
      slider.max = String(frames.length - 1);
      slider.disabled = playBtn.disabled = frames.length < 2;
      showFrame(frames.length - 1);
      const m = p.motion ? motion(masks, times, p, w, h) : null;
      drawMotion(m, rainCentre(masks[masks.length - 1], p, w, h));
      const lastTime = times[times.length - 1];
      console.debug(`radar map: ${p.code} processed in ${Math.round(performance.now() - t0)} ms`);
      say(`Latest frame ${lastTime ? ist(lastTime) : ""} · ${frames.length} frames over 3 hours. Tap ▶ to play.`);
    } else {
      say("Loading the radar picture…");
      const buf = await fetchBuffer(radarImageUrl(RADAR.code, p.code));
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
      say(`Picture ${time ? ist(time) : ""}, with IMD's own map under it. Lower the opacity to see the streets.`);
    }
    loaded = { code: p.code, at: Date.now() };
    note.textContent =
      "IMD Doppler Weather Radar, Chennai. The rain is lifted out of IMD's pictures by the app and placed by their " +
      "latitude/longitude grid, so it can be off by a kilometre or two. Echoes that sit still for 3 hours (sea or " +
      "ground clutter) are dropped along with the map.";
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

export function initRadarMap() {
  productPick.replaceChildren(...PRODUCTS.map((p) => new Option(p.name, p.code)));
  try {
    const saved = localStorage.getItem(PRODUCT_KEY);
    if (PRODUCTS.some((p) => p.code === saved)) productPick.value = saved;
    const o = Number(localStorage.getItem(OPACITY_KEY));
    if (o >= 20 && o <= 100) opacity.value = String(o);
  } catch {}
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
  $("rm-refresh").addEventListener("click", () => load(true));
  $("rm-vvp").src = radarImageUrl(RADAR.code, "vp2");
  slider.disabled = playBtn.disabled = true;
}

export async function showRadarMap() {
  try {
    L = await loadLeaflet();
  } catch (e) {
    say(`Couldn't open the map (${e.message}).`, true);
    return;
  }
  ensureMap();
  setTimeout(() => map.invalidateSize(), 0);
  load();
}

export function hideRadarMap() {
  stop();
}
