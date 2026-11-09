// Lightning near Chennai from IMD's lightning map, as shown on
// https://mausam.imd.gov.in/ ("Satellite lightning nowcast"). IMD redraws it
// every few minutes: an INSAT cloud-top picture of India with the lightning of
// the last 10 min (red stars), 20 min (green diamonds) and 30 min (purple
// circles), from IITM's lightning network. It's a 4-frame GIF; the last frame
// has all three.
//
// The map has latitude/longitude axes, so the marker pixels near Chennai are
// read off the last frame to say how far away the nearest lightning is, and a
// close-up around Chennai is drawn with 50/100/200 km rings.
import { saveImage, loadImage, when } from "./offline.js";
import { shareButton, shareName } from "./share.js";

export const LIGHTNING_URL = "https://mausam.imd.gov.in/lightning/Converted/BT.gif";
const SHOW_KEY = "myweather.lightning.show";

// Where longitude and latitude fall in IMD's 875×656 picture, fitted on
// 2026-11-06 to the coastline it draws (Dwarka, Konkan, Kanyakumari, Point
// Calimere, Chennai): 13.57 px per degree east from 65°E at x=166, and y
// 97..585 for 40°N..5°N. The axis labels sit about 5 px left of the true
// longitudes. The picture itself spans x 161..636.
export const MAP = { width: 875, height: 656, x0: 166, x1: 641, lon0: 65, lon1: 100, y0: 97, y1: 585, lat0: 40, lat1: 5 };
const PLOT = { left: 161, right: 636, top: 97, bottom: 585 };
export const HOME = { name: "Chennai", lat: 13.08, lon: 80.27 };
export const RINGS = [50, 100, 200]; // km
const CROP = { dLat: 2.8, dLon: 2.85 }; // close-up: about ±310 km
const ZOOM = 5;

const $ = (id) => document.getElementById(id);
const showPick = $("lt-show");
const statusEl = $("lt-status");
const summary = $("lt-summary");
const near = $("lt-near");
const img = $("lt-img");
const nearBox = $("lt-near-box");
const indiaBox = $("lt-india-box");

let loadSeq = 0;
let objectUrl = "";
let frame = null; // canvas with the latest full frame
let result = null; // what analyse() found
let imdTime = "";

const xOf = (lon) => MAP.x0 + ((lon - MAP.lon0) / (MAP.lon1 - MAP.lon0)) * (MAP.x1 - MAP.x0);
const yOf = (lat) => MAP.y0 + ((lat - MAP.lat0) / (MAP.lat1 - MAP.lat0)) * (MAP.y1 - MAP.y0);
const lonOf = (x) => MAP.lon0 + ((x - MAP.x0) / (MAP.x1 - MAP.x0)) * (MAP.lon1 - MAP.lon0);
const latOf = (y) => MAP.lat0 + ((y - MAP.y0) / (MAP.y1 - MAP.y0)) * (MAP.lat1 - MAP.lat0);

function km(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

const DIRS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
function direction(lat1, lon1, lat2, lon2) {
  const dy = lat2 - lat1;
  const dx = (lon2 - lon1) * Math.cos((lat1 * Math.PI) / 180);
  const deg = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  return DIRS[Math.round(deg / 45) % 8];
}

// IMD's marker colours: 10, 20 or 30 minutes old, or 0 for anything else.
export function markerAge(r, g, b) {
  if (r > 190 && g < 80 && b < 80) return 10; // red star
  if (g > 190 && r < 100 && b < 100) return 20; // green diamond
  if (b > 190 && r > 80 && r < 180 && g < 90) return 30; // purple circle
  return 0;
}

/**
 * Finds the lightning markers within maxKm of home in an RGBA frame of IMD's
 * map. Touching marker pixels make one "spot" (IMD draws one marker per
 * strike, and close strikes overlap). Each spot has its distance (to the
 * nearest marker middle), direction and freshest age.
 */
export function analyse(data, width, height, home = HOME, maxKm = Math.max(...RINGS) + 100) {
  const pad = maxKm / 100 + 0.5; // degrees, generous
  const xa = Math.max(PLOT.left, Math.floor(xOf(home.lon - pad)));
  const xb = Math.min(PLOT.right, Math.ceil(xOf(home.lon + pad)));
  const ya = Math.max(PLOT.top, Math.floor(yOf(home.lat + pad)));
  const yb = Math.min(PLOT.bottom, Math.ceil(yOf(home.lat - pad)));
  const w = xb - xa + 1;
  const ages = new Uint8Array(w * (yb - ya + 1));
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) {
      const i = (y * width + x) * 4;
      ages[(y - ya) * w + (x - xa)] = markerAge(data[i], data[i + 1], data[i + 2]);
    }
  }
  const h = yb - ya + 1;
  const isMarker = (x, y) => x >= 0 && x < w && y >= 0 && y < h && ages[y * w + x] > 0;
  // How deep inside the markers a pixel is: the largest square of marker
  // pixels around it (up to 13×13). The deepest pixels of a spot are the
  // middles of its markers, where the strikes are; the edge of IMD's circles
  // is 30 km or more from them.
  const depth = (x, y) => {
    let r = 0;
    for (; r < 6; r++) {
      const n = r + 1;
      for (let i = -n; i <= n; i++) {
        if (!isMarker(x + i, y - n) || !isMarker(x + i, y + n) || !isMarker(x - n, y + i) || !isMarker(x + n, y + i)) return r;
      }
    }
    return r;
  };
  const seen = new Uint8Array(ages.length);
  const spots = [];
  for (let start = 0; start < ages.length; start++) {
    if (!ages[start] || seen[start]) continue;
    const stack = [start];
    const pixels = [];
    seen[start] = 1;
    let age = 30;
    while (stack.length) {
      const k = stack.pop();
      pixels.push(k);
      age = Math.min(age, ages[k]);
      const kx = k % w, ky = Math.floor(k / w);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const n = (ky + dy) * w + kx + dx;
          if (isMarker(kx + dx, ky + dy) && !seen[n]) {
            seen[n] = 1;
            stack.push(n);
          }
        }
      }
    }
    // Single stray pixels are anti-aliasing, not markers.
    if (pixels.length < 3) continue;
    const depths = pixels.map((k) => depth(k % w, Math.floor(k / w)));
    const deepest = Math.max(...depths);
    // Each patch of deepest pixels is one marker's middle: use its centre.
    const deep = new Set(pixels.filter((k, i) => depths[i] === deepest));
    let best = Infinity, bestLat = 0, bestLon = 0;
    for (const first of deep) {
      const patch = [first];
      deep.delete(first);
      for (let j = 0; j < patch.length; j++) {
        const kx = patch[j] % w, ky = Math.floor(patch[j] / w);
        for (const n of [patch[j] - 1, patch[j] + 1, patch[j] - w, patch[j] + w, patch[j] - w - 1, patch[j] - w + 1, patch[j] + w - 1, patch[j] + w + 1]) {
          if (deep.has(n) && Math.abs((n % w) - kx) <= 1 && Math.abs(Math.floor(n / w) - ky) <= 1) {
            deep.delete(n);
            patch.push(n);
          }
        }
      }
      const cx = patch.reduce((a, k) => a + (k % w), 0) / patch.length;
      const cy = patch.reduce((a, k) => a + Math.floor(k / w), 0) / patch.length;
      const lat = latOf(cy + ya), lon = lonOf(cx + xa);
      const d = km(home.lat, home.lon, lat, lon);
      if (d < best) [best, bestLat, bestLon] = [d, lat, lon];
    }
    if (best > maxKm) continue;
    spots.push({ km: best, age, dir: direction(home.lat, home.lon, bestLat, bestLon) });
  }
  spots.sort((a, b) => a.km - b.km);
  return { spots, home };
}

// Last frame of the GIF, fully drawn. ImageDecoder (Chrome/WebView 94+) can
// pick a frame; without it only the first frame (last 10 min) is available.
async function latestFrame(blob) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if ("ImageDecoder" in window) {
    try {
      const dec = new ImageDecoder({ data: await blob.arrayBuffer(), type: blob.type || "image/gif" });
      await dec.tracks.ready;
      const count = dec.tracks.selectedTrack.frameCount;
      const { image } = await dec.decode({ frameIndex: Math.max(0, count - 1) });
      canvas.width = image.displayWidth;
      canvas.height = image.displayHeight;
      ctx.drawImage(image, 0, 0);
      image.close();
      dec.close();
      return { canvas, ctx, all: true };
    } catch {}
  }
  const bmp = await createImageBitmap(blob);
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  ctx.drawImage(bmp, 0, 0);
  bmp.close?.();
  return { canvas, ctx, all: false };
}

function say(text, error = false) {
  statusEl.textContent = text;
  statusEl.className = error ? "status error" : "status";
}

const AGE_TEXT = { 10: "in the last 10 minutes", 20: "10–20 minutes ago", 30: "20–30 minutes ago" };
const spotsWord = (n) => (n === 1 ? "1 spot" : `${n} spots`);

export function headline(res, all = true) {
  const span = all ? "30 minutes" : "10 minutes";
  const far = Math.max(...RINGS);
  const first = res.spots.find((s) => s.km <= far);
  if (!first) return `No lightning within ${far} km of ${res.home.name} in the last ${span}.`;
  const dist = first.km < 8 ? "Lightning over" : `Lightning about ${Math.round(first.km / 5) * 5} km ${first.dir} of`;
  return `${dist} ${res.home.name}, ${AGE_TEXT[first.age]}.`;
}

function renderSummary(all) {
  summary.replaceChildren();
  if (!result) return;
  const h = document.createElement("strong");
  h.className = "lt-headline";
  h.textContent = headline(result, all);
  const list = document.createElement("ul");
  list.className = "lt-rings";
  for (const r of RINGS) {
    const inside = result.spots.filter((s) => s.km <= r);
    const li = document.createElement("li");
    const fresh = inside.length ? Math.min(...inside.map((s) => s.age)) : 0;
    li.innerHTML = `<span>Within ${r} km</span><b></b>`;
    li.querySelector("b").textContent = inside.length
      ? `${spotsWord(inside.length)} · newest ${fresh === 10 ? "< 10 min" : `${fresh - 10}–${fresh} min`}`
      : "none";
    if (fresh) li.dataset.age = fresh;
    list.append(li);
  }
  summary.append(h, list);
  if (!all) {
    const p = document.createElement("small");
    p.textContent = "This phone could only read the last 10 minutes; older lightning isn't counted.";
    summary.append(p);
  }
}

// Close-up around home from the full frame, with distance rings.
function drawNear() {
  if (!frame) return;
  const sx = Math.round(xOf(HOME.lon - CROP.dLon));
  const sy = Math.round(yOf(HOME.lat + CROP.dLat));
  const sw = Math.round(xOf(HOME.lon + CROP.dLon)) - sx;
  const sh = Math.round(yOf(HOME.lat - CROP.dLat)) - sy;
  near.width = sw * ZOOM;
  near.height = sh * ZOOM;
  const ctx = near.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(frame.canvas, sx, sy, sw, sh, 0, 0, near.width, near.height);
  const cx = (xOf(HOME.lon) - sx) * ZOOM;
  const cy = (yOf(HOME.lat) - sy) * ZOOM;
  const pxPerKmX = ((MAP.x1 - MAP.x0) / (MAP.lon1 - MAP.lon0) / (111.32 * Math.cos((HOME.lat * Math.PI) / 180))) * ZOOM;
  const pxPerKmY = ((MAP.y1 - MAP.y0) / (MAP.lat0 - MAP.lat1) / 111.2) * ZOOM;
  ctx.font = "600 22px system-ui, sans-serif";
  ctx.textAlign = "center";
  for (const r of RINGS) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * pxPerKmX, r * pxPerKmY, 0, 0, 2 * Math.PI);
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.stroke();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#4dd0e1";
    ctx.stroke();
    const ty = cy - r * pxPerKmY - 8;
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(0,0,0,0.7)";
    ctx.strokeText(`${r} km`, cx, ty);
    ctx.fillStyle = "#e0f7fa";
    ctx.fillText(`${r} km`, cx, ty);
  }
  ctx.beginPath();
  ctx.arc(cx, cy, 8, 0, 2 * Math.PI);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#1565c0";
  ctx.stroke();
  ctx.textAlign = "left";
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(0,0,0,0.7)";
  ctx.strokeText(HOME.name, cx + 14, cy + 30);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(HOME.name, cx + 14, cy + 30);
}

function applyShow() {
  const india = showPick.value === "india";
  nearBox.hidden = india || !frame;
  indiaBox.hidden = !india && !!frame;
}

async function useBlob(blob, seq) {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(blob);
  img.src = objectUrl;
  frame = null;
  result = null;
  try {
    const f = await latestFrame(blob);
    if (seq !== loadSeq) return;
    if (f.canvas.width !== MAP.width || f.canvas.height !== MAP.height) {
      summary.replaceChildren(
        Object.assign(document.createElement("small"), {
          textContent: "IMD has changed the map's layout, so distances from Chennai can't be worked out. The map is below.",
        })
      );
    } else {
      frame = f;
      const { data } = f.ctx.getImageData(0, 0, f.canvas.width, f.canvas.height);
      result = analyse(data, f.canvas.width, f.canvas.height);
      renderSummary(f.all);
      drawNear();
    }
  } catch {
    summary.replaceChildren();
  }
  applyShow();
}

const imdText = (t) => (t && !isNaN(Date.parse(t)) ? ` · IMD map of ${when(Date.parse(t))}` : "");

async function load() {
  const seq = ++loadSeq;
  say("Loading IMD's lightning map…");
  let httpError = false;
  try {
    const res = await fetch(`${LIGHTNING_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) {
      httpError = true;
      throw new Error(`HTTP ${res.status}`);
    }
    const blob = await res.blob();
    if (!blob.type.startsWith("image/")) {
      httpError = true;
      throw new Error("not an image");
    }
    if (seq !== loadSeq) return;
    imdTime = res.headers.get("last-modified") || "";
    await useBlob(blob, seq);
    say(`Updated ${new Date().toLocaleTimeString()}${imdText(imdTime)}`);
    saveImage(LIGHTNING_URL, { blob, savedAt: Date.now(), imdTime });
  } catch {
    if (seq !== loadSeq) return;
    const saved = await loadImage(LIGHTNING_URL);
    if (seq !== loadSeq) return;
    if (saved) {
      imdTime = saved.imdTime;
      await useBlob(saved.blob, seq);
      const why = httpError ? "IMD isn't serving the lightning map right now" : "No connection";
      say(`${why}. Showing the copy saved at ${when(saved.savedAt)}${imdText(saved.imdTime)}.`, true);
    } else if (httpError) {
      say("IMD's lightning map isn't available right now. Try again in a few minutes.", true);
    } else {
      // A browser without the app's CORS header: show IMD's picture as is.
      frame = result = null;
      summary.replaceChildren(
        Object.assign(document.createElement("small"), {
          textContent: "Distances from Chennai are worked out in the Android app.",
        })
      );
      img.src = `${LIGHTNING_URL}?t=${Date.now()}`;
      applyShow();
      say(`Updated ${new Date().toLocaleTimeString()}`);
    }
  }
}

// Shares what's on screen: the close-up with its rings, or the whole map.
function shareLightning() {
  if (!frame) return null;
  const canvas = showPick.value === "india" ? frame.canvas : near;
  return new Promise((resolve) =>
    canvas.toBlob((blob) => {
      if (!blob) return resolve(null);
      const time = imdTime && !isNaN(Date.parse(imdTime)) ? ` (IMD lightning map, ${when(Date.parse(imdTime))})` : " (IMD lightning map)";
      const line = result ? headline(result, frame.all).replace(/\.$/, "") : "Lightning over India";
      const text = `${line}${time}. Shared from MyWeather.`;
      resolve({ blob, name: shareName("lightning", "image/png"), text, imd: true });
    }, "image/png")
  );
}

export function initLightning() {
  try {
    const saved = localStorage.getItem(SHOW_KEY);
    if (saved === "near" || saved === "india") showPick.value = saved;
  } catch {}
  showPick.addEventListener("change", () => {
    try {
      localStorage.setItem(SHOW_KEY, showPick.value);
    } catch {}
    applyShow();
  });
  $("lt-refresh").addEventListener("click", load);
  shareButton($("lt-share"), shareLightning, say);
}

// IMD redraws the map every few minutes, so it's fetched each time the
// screen opens.
export function showLightning() {
  load();
}
