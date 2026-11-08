// Nowcast screen (#nowcast): will rain reach a place in Tamil Nadu in the
// next 2 hours? The place is a district, a searched place name or pincode,
// the phone's position, or a spot tapped on the map. The answer comes from the
// mosaic of all five radars (js/mosaic.js) and the nowcast sum in
// js/nowcast.js; the same mosaic answers for every district at once.
import { loadLeaflet, addTiles } from "./stationmap.js";
import { searchPlaces } from "./places.js";
import { nowcastAt, headline, saveNowcast } from "./nowcast.js";
import { buildMosaic, frameImage, DBZ_BANDS } from "./mosaic.js";
import { nowcastPlace, setNowcastPlace, ist } from "./radarmap.js";

const PLACE_KEY = "myweather.nowcastview.place";

// District centres (centroid of each district's outline, TN-SMART district_tn.geojson).
export const TN_DISTRICTS = [
  ["Ariyalur", 11.16, 79.24], ["Chengalpattu", 12.57, 80.0], ["Chennai", 13.06, 80.23], ["Coimbatore", 10.88, 76.98],
  ["Cuddalore", 11.53, 79.45], ["Dharmapuri", 12.1, 78.19], ["Dindigul", 10.39, 77.82], ["Erode", 11.52, 77.41],
  ["Kallakurichi", 11.8, 79.01], ["Kancheepuram", 12.83, 79.84], ["Kanniyakumari", 8.31, 77.36], ["Karur", 10.84, 78.13],
  ["Krishnagiri", 12.49, 78.03], ["Madurai", 9.92, 78.01], ["Mayiladuthurai", 11.15, 79.71], ["Nagapattinam", 10.57, 79.76],
  ["Namakkal", 11.32, 78.14], ["Nilgiris", 11.46, 76.64], ["Perambalur", 11.27, 78.89], ["Pudukkottai", 10.36, 78.88],
  ["Ramanathapuram", 9.44, 78.69], ["Ranipet", 12.95, 79.46], ["Salem", 11.68, 78.22], ["Sivagangai", 9.92, 78.6],
  ["Tenkasi", 9.08, 77.45], ["Thanjavur", 10.67, 79.24], ["Theni", 9.89, 77.44], ["Thiruchirappalli", 10.89, 78.57],
  ["Thiruvarur", 10.68, 79.53], ["Thoothukudi", 8.9, 78.0], ["Tirunelveli", 8.58, 77.6], ["Tirupathur", 12.58, 78.64],
  ["Tiruppur", 10.84, 77.41], ["Tiruvallur", 13.24, 79.93], ["Tiruvannamalai", 12.43, 79.17], ["Vellore", 12.9, 78.96],
  ["Villupuram", 12.12, 79.53], ["Virudhunagar", 9.49, 77.91],
];

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const compass = (deg) => COMPASS[Math.round(deg / 22.5) % 16];

const $ = (id) => document.getElementById(id);
const status = $("nw-status");

let L = null;
let map = null;
let overlay = null;
let pin = null;
let mosaic = null; // the latest build
let overlayUrl = "";
let run = 0;

function say(text, error = false) {
  status.textContent = text;
  status.className = error ? "status error" : "status";
}

const readJson = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
};

function place() {
  const p = readJson(PLACE_KEY);
  if (p && typeof p.lat === "number") return p;
  const home = nowcastPlace();
  return { lat: home.lat, lon: home.lon, name: home.name };
}

function setPlace(p) {
  try {
    localStorage.setItem(PLACE_KEY, JSON.stringify({ lat: p.lat, lon: p.lon, name: p.name, district: p.district || "" }));
  } catch {}
  $("nw-district").value = p.district || "";
  $("nw-results").replaceChildren();
  answer();
  map?.setView([p.lat, p.lon], Math.max(map.getZoom(), 8));
}

// ---- Answer for the chosen place ----

function answer() {
  const p = place();
  $("nw-place").textContent = `${p.name} · ${p.lat.toFixed(3)}°N ${p.lon.toFixed(3)}°E`;
  if (map) {
    const ll = [p.lat, p.lon];
    if (pin) pin.setLatLng(ll);
    else
      pin = L.marker(ll, {
        icon: L.divIcon({ className: "", html: '<span class="nc-pin">📍</span>', iconSize: null }),
        interactive: false,
      }).addTo(map);
  }
  const box = $("nw-answer");
  box.replaceChildren();
  if (!mosaic) return;
  const last = mosaic.frames[mosaic.frames.length - 1];
  const grid = mosaic.grid(last);
  const mo = mosaic.motionAt(p.lat, p.lon);
  const res = nowcastAt(grid, mo, p.lat, p.lon);
  box.classList.toggle("wet", res.raining || res.eta !== null);
  const icon = document.createElement("span");
  icon.className = "nw-icon";
  icon.textContent = res.raining ? "🌧️" : res.eta !== null ? "🌦️" : "🌤️";
  const text = document.createElement("div");
  const b = document.createElement("b");
  b.textContent = `${p.name}: `;
  const h = document.createElement("span");
  h.textContent = res.edge && res.eta === null && !res.raining && !res.nearest ? "outside the radars' reach." : headline(res);
  const small = document.createElement("small");
  small.textContent =
    (mo && mo.speed >= 5 ? `Rain here is moving toward the ${compass(mo.toward)} at about ${Math.round(mo.speed)} km/h. ` : "") +
    `Radar at ${ist(last.time)}. A rough guide: rain grows, fades and turns.`;
  text.append(b, h, document.createElement("br"), small);
  box.append(icon, text);
  // Home's card shows the last answer for its own spot.
  const home = nowcastPlace();
  if (Math.abs(home.lat - p.lat) < 0.005 && Math.abs(home.lon - p.lon) < 0.005)
    saveNowcast({ at: Date.now(), frame: last.time.valueOf(), place: home.name, lat: p.lat, lon: p.lon, radar: "Tamil Nadu radars", result: res });
}

// ---- Every district ----

function districtRows() {
  const list = $("nw-districts");
  if (!mosaic) return list.replaceChildren();
  const last = mosaic.frames[mosaic.frames.length - 1];
  const grid = mosaic.grid(last);
  const rows = TN_DISTRICTS.map(([name, lat, lon]) => {
    const res = nowcastAt(grid, mosaic.motionAt(lat, lon), lat, lon);
    const rank = res.raining ? -1 : res.eta !== null ? res.eta : res.nearest ? 1000 + res.nearest.km : 9999;
    return { name, lat, lon, res, rank };
  }).sort((a, b) => a.rank - b.rank);
  const label = (r) =>
    r.res.raining
      ? "Raining now"
      : r.res.eta !== null
        ? `In ~${Math.max(5, Math.round(r.res.eta / 5) * 5)} min`
        : r.res.nearest && r.res.nearest.km < 150
          ? `Dry · rain ${Math.round(r.res.nearest.km)} km ${r.res.nearest.toward}`
          : "Dry";
  list.replaceChildren(
    ...rows.map((r) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "rank-row" + (r.res.raining ? " nw-wet" : r.res.eta !== null ? " nw-soon" : "");
      const n = document.createElement("span");
      n.className = "rank-name";
      n.textContent = r.name;
      const v = document.createElement("span");
      v.className = "rank-val";
      v.textContent = label(r);
      btn.append(n, v);
      btn.addEventListener("click", () => {
        setPlace({ lat: r.lat, lon: r.lon, name: r.name, district: r.name });
        $("nw-answer").scrollIntoView({ behavior: "smooth", block: "center" });
      });
      li.append(btn);
      return li;
    })
  );
  const wet = rows.filter((r) => r.res.raining).length;
  const soon = rows.filter((r) => !r.res.raining && r.res.eta !== null).length;
  $("nw-districts-sum").textContent = `${wet} raining now · ${soon} with rain on the way · ${rows.length - wet - soon} dry. Tap one to see it.`;
}

// ---- Radar ----

async function load(force = false) {
  const me = ++run;
  try {
    const m = await buildMosaic({ force, onStep: (t) => me === run && say(t) });
    if (me !== run) return;
    mosaic = m;
    const last = m.frames[m.frames.length - 1];
    if (map) {
      const url = await frameImage(last.dbz);
      if (overlayUrl) URL.revokeObjectURL(overlayUrl);
      overlayUrl = url;
      const b = [
        [m.p.lat[0] - m.h / m.p.lat[2], m.p.lon[0]],
        [m.p.lat[0], m.p.lon[0] + m.w / m.p.lon[2]],
      ];
      if (!overlay) overlay = L.imageOverlay(url, b, { opacity: 0.85, interactive: false, className: "nw-rain" }).addTo(map);
      else overlay.setUrl(url);
    }
    const missing = m.layers.filter((l) => l.error);
    say(
      `Radar at ${ist(last.time)} from ${m.layers.length - missing.length} of 5 radars.` +
        (missing.length ? ` Left out: ${missing.map((l) => l.name).join(", ")}.` : "")
    );
    answer();
    districtRows();
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

// ---- Picking a place ----

async function runSearch() {
  const q = $("nw-q").value.trim();
  const list = $("nw-results");
  if (!q) return;
  const li = (text) => Object.assign(document.createElement("li"), { textContent: text });
  list.replaceChildren(li("Searching…"));
  try {
    const found = await searchPlaces(q);
    if (!found.length) return list.replaceChildren(li("No place found. Try a nearby area or another spelling."));
    list.replaceChildren(
      ...found.map((f) => {
        const row = document.createElement("li");
        const b = document.createElement("button");
        b.type = "button";
        b.className = "rank-row";
        const s = document.createElement("span");
        s.className = "rank-name";
        s.textContent = f.detail ? `${f.name} · ${f.detail}` : f.name;
        b.append(s);
        b.addEventListener("click", () => {
          $("nw-q").value = "";
          setPlace({ lat: f.lat, lon: f.lon, name: f.name });
          map?.setView([f.lat, f.lon], 10);
        });
        row.append(b);
        return row;
      })
    );
  } catch (e) {
    list.replaceChildren(
      li(/Failed to fetch|NetworkError|Load failed/.test(e.message) ? "Couldn't search just now. Check the connection." : `Couldn't search (${e.message}).`)
    );
  }
}

function useGps() {
  if (!navigator.geolocation) return say("This phone can't share its location.", true);
  say("Finding your location…");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      setPlace({ lat: pos.coords.latitude, lon: pos.coords.longitude, name: "Your location" });
      say(mosaic ? `Radar at ${ist(mosaic.frames[mosaic.frames.length - 1].time)}.` : "");
    },
    (err) => say(`Couldn't get your location (${err.message}).`, true),
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 5 * 60 * 1000 }
  );
}

function ensureMap() {
  if (map) return;
  const box = $("nw-map");
  const p = place();
  map = L.map(box, { zoomControl: true }).setView([p.lat, p.lon], 7);
  addTiles(L, map, box);
  map.on("click", (e) => setPlace({ lat: e.latlng.lat, lon: e.latlng.lng, name: "Picked spot" }));
}

export function initNowcastView() {
  $("nw-district").append(...TN_DISTRICTS.map(([n]) => new Option(n, n)));
  $("nw-district").addEventListener("change", () => {
    const d = TN_DISTRICTS.find(([n]) => n === $("nw-district").value);
    if (d) setPlace({ lat: d[1], lon: d[2], name: d[0], district: d[0] });
  });
  $("nw-go").addEventListener("click", runSearch);
  $("nw-q").addEventListener("keydown", (e) => {
    if (e.key === "Enter") runSearch();
  });
  $("nw-gps").addEventListener("click", useGps);
  $("nw-home").addEventListener("click", () => {
    const p = place();
    setNowcastPlace({ lat: p.lat, lon: p.lon, name: p.name });
    answer(); // saves this answer for Home's card
    $("nw-home").textContent = "✓ Home's Rain coming? now shows this place";
    setTimeout(() => ($("nw-home").textContent = "Use this place on Home"), 4000);
  });
  $("nw-refresh").addEventListener("click", () => load(true));
  $("nw-legend").replaceChildren(
    ...DBZ_BANDS.map(([, c, label]) => {
      const s = document.createElement("span");
      s.style.setProperty("--level", c);
      s.textContent = label;
      return s;
    })
  );
  const p = place();
  $("nw-district").value = p.district || "";
}

export async function showNowcastView() {
  try {
    L = await loadLeaflet();
    ensureMap();
    setTimeout(() => map.invalidateSize(), 0);
  } catch (e) {
    $("nw-map").textContent = `Couldn't open the map (${e.message}). Pick a district or search instead.`;
  }
  answer();
  load();
}

