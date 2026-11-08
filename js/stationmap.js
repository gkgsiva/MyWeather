// Station map (#map): every saved Wunderground station on a map of Chennai,
// each marked with its rain today, rain rate or temperature and coloured by
// it. Tap a station for its readings and links to its page and rain history.
//
// Positions come with the readings (api.weather.com observations/current) and
// are kept on the phone, so the map can be drawn from the last readings when
// the network drops. The map is Leaflet (bundled in js/vendor/leaflet) with
// OpenStreetMap tiles, darkened to match a dark theme.
import { loadStations, apiKey, fetchReading, loadLast } from "./wunderground.js";
import { when } from "./offline.js";
import { pwsFlags, isSuspect, skipSuspects } from "./health.js";

const COORDS_KEY = "myweather.pws.coords";
const SHOW_KEY = "myweather.map.show";
const TTL = 5 * 60 * 1000;
const CHENNAI = [13.04, 80.22];
const NEAR_DEG = 0.6; // stations within ~65 km fit the first view

const $ = (id) => document.getElementById(id);
const status = $("map-status");
const showPick = $("map-show");
const legend = $("map-legend");
const box = $("map-box");

let L = null;
let map = null;
let layer = null;
let readings = new Map(); // id -> observation | null | Error
let loadedAt = 0;
let fitted = false;
let fitAll = false; // "All stations" fits the far ones too (Vellore, Puducherry…)

function say(text, error = false) {
  status.textContent = text;
  status.className = error ? "status error" : "status";
}

// ---- Colour scales ----

// Rain in mm, on IMD's daily bands (very light, light, moderate, heavy, very heavy, extremely heavy).
export const RAIN = [
  [0.01, "#9aa4af", "None"],
  [2.5, "#9fd3ff", "< 2.5"],
  [15.6, "#4aa3ff", "2.5–15.5"],
  [64.5, "#1565c0", "15.6–64.4"],
  [115.6, "#7b1fa2", "64.5–115.5"],
  [204.5, "#c2185b", "115.6–204.4"],
  [Infinity, "#b71c1c", "204.5+"],
];
const RATE = [
  [0.01, "#9aa4af", "None"],
  [2.5, "#9fd3ff", "< 2.5"],
  [10, "#4aa3ff", "2.5–10"],
  [50, "#1565c0", "10–50"],
  [Infinity, "#7b1fa2", "50+"],
];
const TEMP = [
  [24, "#4aa3ff", "< 24°"],
  [27, "#26a69a", "24–27°"],
  [30, "#9ccc65", "27–30°"],
  [33, "#ffca28", "30–33°"],
  [36, "#fb8c00", "33–36°"],
  [Infinity, "#e53935", "36°+"],
];
const MODES = {
  rain: { label: "Rain today", unit: "mm", scale: RAIN, value: (m) => m.precipTotal },
  rate: { label: "Rain rate now", unit: "mm/h", scale: RATE, value: (m) => m.precipRate },
  temp: { label: "Temperature", unit: "°C", scale: TEMP, value: (m) => m.temp },
};
export const colour = (scale, v) => (typeof v === "number" ? scale.find(([max]) => v < max)[1] : "#9aa4af");
// Dark text on light pills.
export const LIGHT = new Set(["#9fd3ff", "#9ccc65", "#ffca28", "#9aa4af", "#26a69a", "#4aa3ff", "#fb8c00"]);
const fmt = (v) => (typeof v === "number" ? (Math.abs(v) < 10 && v % 1 ? v.toFixed(1) : String(Math.round(v * 10) / 10)) : "–");

function renderLegend(mode) {
  const m = MODES[mode];
  legend.replaceChildren(
    ...m.scale.map(([, c, label]) => {
      const s = document.createElement("span");
      s.style.setProperty("--level", c);
      s.textContent = label;
      return s;
    }),
    Object.assign(document.createElement("small"), { textContent: m.unit })
  );
}

// ---- Positions kept on the phone ----

export function loadCoords() {
  try {
    return JSON.parse(localStorage.getItem(COORDS_KEY)) || {};
  } catch {
    return {};
  }
}
function saveCoords(found) {
  const c = { ...loadCoords(), ...found };
  try {
    localStorage.setItem(COORDS_KEY, JSON.stringify(c));
  } catch {}
}

// ---- Leaflet, loaded the first time the map opens ----

export function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  return new Promise((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "js/vendor/leaflet/leaflet.css";
    document.head.append(css);
    const s = document.createElement("script");
    s.src = "js/vendor/leaflet/leaflet.js";
    s.onload = () => resolve(window.L);
    s.onerror = () => reject(new Error("map library didn't load"));
    document.head.append(s);
  });
}

export const isDark = () => {
  const t = document.documentElement.dataset.theme;
  return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
};

// OpenStreetMap's standard tiles. The Android app fetches them with its own
// User-Agent, as OpenStreetMap's tile policy asks. Dark mode inverts them.
// Used by the flood and wind maps too.
export function addTiles(L, map, box) {
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  const theme = () => box.classList.toggle("dark-tiles", isDark());
  theme();
  // Theme button or phone theme changes.
  new MutationObserver(theme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", theme);
}

function ensureMap() {
  if (map) return;
  map = L.map(box, { zoomControl: true, attributionControl: true }).setView(CHENNAI, 10);
  layer = L.layerGroup().addTo(map);
  addTiles(L, map, box);
}

// ---- Markers ----

function draw() {
  const mode = showPick.value;
  const m = MODES[mode];
  const coords = loadCoords();
  const stations = loadStations();
  layer.clearLayers();
  const flags = pwsFlags(readings, coords);
  const skip = skipSuspects();
  const seen = new Set();
  const placed = [];
  let missing = 0;
  for (const s of stations) {
    if (seen.has(s.id)) continue; // two nicknames for one station
    seen.add(s.id);
    const names = stations.filter((x) => x.id === s.id).map((x) => x.name).join(" / ");
    const r = readings.get(s.id);
    const obs = r && !(r instanceof Error) ? r : null;
    const pos = obs && typeof obs.lat === "number" ? [obs.lat, obs.lon] : coords[s.id];
    if (!pos) {
      missing++;
      continue;
    }
    const v = obs ? m.value(obs.metric || {}) : undefined;
    const flag = flags.get(s.id);
    const suspect = isSuspect(flag);
    // A suspect reading is greyed out (unless Station health says show it).
    const c = suspect && skip ? "#9aa4af" : colour(m.scale, v);
    const stale = obs && Date.now() - obs.epoch * 1000 > 60 * 60 * 1000;
    const icon = L.divIcon({
      className: "",
      html: `<span class="pin${stale ? " stale" : ""}${obs ? "" : " off"}${suspect ? " suspect" : ""}" style="background:${c};color:${LIGHT.has(c) ? "#111" : "#fff"}">${obs ? fmt(v) : "–"}${suspect ? "?" : ""}</span>`,
      iconSize: null,
    });
    const marker = L.marker(pos, { icon, title: names, keyboard: true });
    const mm = obs?.metric || {};
    const at = obs ? new Date(obs.epoch * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
    const pop = document.createElement("div");
    pop.className = "map-pop";
    pop.innerHTML = `<strong></strong><span></span><small></small><a></a><a></a>`;
    pop.querySelector("strong").textContent = names;
    pop.querySelector("span").textContent = obs
      ? `Rain ${fmt(mm.precipTotal)} mm today · ${fmt(mm.precipRate)} mm/h now · ${fmt(mm.temp)}°C`
      : r === null
        ? "Offline, no recent data"
        : "No reading";
    pop.querySelector("small").textContent = obs ? `${s.id} · at ${at}${stale ? " (over an hour old)" : ""}` : s.id;
    if (suspect) {
      const w = document.createElement("small");
      w.className = "health-why";
      w.textContent = `${flag.level === "bad" ? "Wrong reading" : "Odd reading"}: ${flag.why.join("; ")}`;
      pop.querySelector("small").after(w);
    }
    const [page, rain] = pop.querySelectorAll("a");
    page.href = `#wunderground?id=${encodeURIComponent(s.id)}`;
    page.textContent = "Station page";
    rain.href = `#rain?id=${encodeURIComponent(s.id)}`;
    rain.textContent = "Rain history";
    marker.bindPopup(pop);
    marker.addTo(layer);
    placed.push(pos);
  }
  if (!fitted && placed.length) {
    const near = placed.filter(([la, lo]) => Math.abs(la - CHENNAI[0]) < NEAR_DEG && Math.abs(lo - CHENNAI[1]) < NEAR_DEG);
    map.fitBounds(L.latLngBounds(near.length && !fitAll ? near : placed), { padding: [24, 24], maxZoom: 12 });
    fitted = true;
  }
  return missing;
}

// Current readings for every saved station; positions are kept on the phone.
export async function fetchAll(key) {
  const ids = [...new Set(loadStations().map((s) => s.id))];
  const fresh = new Map();
  let reached = false;
  let keyError = false;
  await Promise.all(
    ids.map(async (id) => {
      try {
        fresh.set(id, await fetchReading(id, key));
        reached = true;
      } catch (e) {
        if (e.key) keyError = true;
        if (e.key || e.message.startsWith("HTTP")) reached = true;
        fresh.set(id, e);
      }
    })
  );
  const found = {};
  for (const [id, r] of fresh) if (r && !(r instanceof Error) && typeof r.lat === "number") found[id] = [r.lat, r.lon];
  saveCoords(found);
  return { fresh, reached, keyError };
}

async function refresh() {
  const key = apiKey();
  if (!key) {
    readings = new Map();
    draw();
    say("Add your Wunderground API key under Wunderground → Manage stations to see the stations.", true);
    return;
  }
  say("Loading readings…");
  const { fresh, reached, keyError } = await fetchAll(key);
  if (!reached) {
    const last = loadLast();
    readings = last ? new Map(Object.entries(last.readings)) : new Map();
    draw();
    say(last ? `No connection. Showing readings saved at ${when(last.at)}.` : "No connection, and no saved readings yet.", true);
    return;
  }
  readings = fresh;
  loadedAt = Date.now();
  const missing = draw();
  if (keyError) say("Wunderground didn't accept the API key. Check it under Wunderground → Manage stations.", true);
  else
    say(
      `Updated ${new Date().toLocaleTimeString()}${missing ? ` · ${missing} station(s) not shown: no position yet` : ""}. Tap a station for details.`
    );
}

export function initMap() {
  let saved = "rain";
  try {
    saved = localStorage.getItem(SHOW_KEY) || "rain";
  } catch {}
  showPick.replaceChildren(...Object.entries(MODES).map(([k, v]) => new Option(v.label, k)));
  showPick.value = MODES[saved] ? saved : "rain";
  renderLegend(showPick.value);
  showPick.addEventListener("change", () => {
    try {
      localStorage.setItem(SHOW_KEY, showPick.value);
    } catch {}
    renderLegend(showPick.value);
    if (map) draw();
  });
  $("map-refresh").addEventListener("click", refresh);
  $("map-fit").addEventListener("click", () => {
    fitted = false;
    fitAll = true;
    if (map) draw();
  });
}

export async function showMap() {
  try {
    L = await loadLeaflet();
  } catch (e) {
    say(`Couldn't open the map (${e.message}).`, true);
    return;
  }
  ensureMap();
  // The box was hidden until now; let Leaflet measure it.
  setTimeout(() => map.invalidateSize(), 0);
  if (!readings.size) {
    const last = loadLast();
    if (last) readings = new Map(Object.entries(last.readings));
  }
  draw();
  if (Date.now() - loadedAt > TTL) refresh();
}
