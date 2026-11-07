// Flood spots (#floods): Chennai's known waterlogging spots (js/flood-spots.js)
// on a map, with today's rain at the saved Wunderground stations. Each spot is
// coloured by the rain at the nearest station within 6 km, and the list under
// the map puts the spots with the most rain nearby first. Your own spots can
// be added (kept on the phone). Linked from the Chennai radar.
import { apiKey, loadStations, loadLast } from "./wunderground.js";
import { loadLeaflet, addTiles, loadCoords, fetchAll, RAIN, colour, LIGHT } from "./stationmap.js";
import { FLOOD_SPOTS } from "./flood-spots.js";
import { when } from "./offline.js";

const MINE_KEY = "myweather.floods.mine";
const TTL = 5 * 60 * 1000;
const NEAR_KM = 6;
const CHENNAI = [13.03, 80.21];

// How likely a spot is to be under water from the rain near it. A rough
// guide: Chennai's drains are designed for about 50–70 mm a day, and short
// bursts of 20–30 mm an hour flood subways.
const RISK = [
  { id: "high", label: "Likely flooded", test: (mm, rate) => mm >= 64.5 || rate >= 30 },
  { id: "watch", label: "Watch", test: (mm, rate) => mm >= 30 || rate >= 15 },
  { id: "low", label: "Low", test: (mm) => typeof mm === "number" },
  { id: "unknown", label: "No station near", test: () => true },
];
export const riskOf = (mm, rate) => RISK.find((r) => r.test(mm, rate || 0));

const $ = (id) => document.getElementById(id);
const box = $("flood-map");
const status = $("flood-status");
const list = $("flood-list");
const nameInput = $("flood-name");

let L = null;
let map = null;
let spotLayer = null;
let stationLayer = null;
let readings = new Map();
let loadedAt = 0;

function say(text, error = false) {
  status.textContent = text;
  status.className = error ? "status error" : "status";
}

function loadMine() {
  try {
    const m = JSON.parse(localStorage.getItem(MINE_KEY));
    return Array.isArray(m) ? m.filter((s) => s && s.name && typeof s.lat === "number" && typeof s.lon === "number") : [];
  } catch {
    return [];
  }
}
function saveMine(spots) {
  try {
    localStorage.setItem(MINE_KEY, JSON.stringify(spots));
  } catch {}
}

export function km(a, b) {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad;
  const dLon = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Stations with a position and today's reading.
function stationPoints() {
  const coords = loadCoords();
  const names = new Map();
  for (const s of loadStations()) names.set(s.id, names.has(s.id) ? `${names.get(s.id)} / ${s.name}` : s.name);
  const out = [];
  for (const [id, name] of names) {
    const r = readings.get(id);
    const obs = r && !(r instanceof Error) ? r : null;
    const pos = obs && typeof obs.lat === "number" ? [obs.lat, obs.lon] : coords[id];
    if (!pos) continue;
    const fresh = obs && Date.now() - obs.epoch * 1000 < 2 * 60 * 60 * 1000;
    out.push({ id, name, pos, mm: fresh ? obs.metric?.precipTotal : undefined, rate: fresh ? obs.metric?.precipRate : undefined, obs });
  }
  return out;
}

// Each spot with its nearest reporting station within NEAR_KM.
export function rankSpots(spots, stations) {
  return spots
    .map((spot) => {
      let best = null;
      for (const st of stations) {
        if (typeof st.mm !== "number") continue;
        const d = km([spot.lat, spot.lon], st.pos);
        if (d <= NEAR_KM && (!best || d < best.d)) best = { ...st, d };
      }
      return { spot, near: best, risk: riskOf(best?.mm, best?.rate) };
    })
    .sort((a, b) => (b.near?.mm ?? -1) - (a.near?.mm ?? -1) || (b.near?.rate ?? -1) - (a.near?.rate ?? -1));
}

const fmt = (v) => (typeof v === "number" ? v.toFixed(1) : "–");

function draw() {
  const mine = loadMine();
  const spots = [...FLOOD_SPOTS, ...mine.map((s) => ({ ...s, kind: "mine" }))];
  const stations = stationPoints();
  const ranked = rankSpots(spots, stations);

  spotLayer.clearLayers();
  for (const { spot, near, risk } of ranked) {
    const icon = L.divIcon({
      className: "",
      html: `<span class="spot spot-${risk.id} spot-${spot.kind}" aria-hidden="true">${spot.kind === "subway" ? "U" : "!"}</span>`,
      iconSize: null,
    });
    const marker = L.marker([spot.lat, spot.lon], { icon, title: spot.name, keyboard: true });
    const pop = document.createElement("div");
    pop.className = "map-pop";
    pop.innerHTML = "<strong></strong><span></span><small></small>";
    pop.querySelector("strong").textContent = spot.name;
    pop.querySelector("span").textContent = near
      ? `${risk.label}: ${fmt(near.mm)} mm today, ${fmt(near.rate)} mm/h now at ${near.name} (${near.d.toFixed(1)} km)`
      : `No station within ${NEAR_KM} km is reporting.`;
    pop.querySelector("small").textContent =
      spot.kind === "subway" ? "Subway, closed when it fills" : spot.kind === "mine" ? "Your spot" : "Low-lying area";
    if (spot.kind === "mine") {
      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "secondary small";
      rm.textContent = "Remove this spot";
      rm.addEventListener("click", () => {
        saveMine(loadMine().filter((s) => !(s.name === spot.name && s.lat === spot.lat && s.lon === spot.lon)));
        map.closePopup();
        draw();
      });
      pop.append(rm);
    }
    marker.bindPopup(pop);
    marker.addTo(spotLayer);
  }

  stationLayer.clearLayers();
  for (const st of stations) {
    const c = colour(RAIN, st.mm);
    const icon = L.divIcon({
      className: "",
      html: `<span class="pin small-pin${typeof st.mm === "number" ? "" : " off"}" style="background:${c};color:${LIGHT.has(c) ? "#111" : "#fff"}">${fmt(st.mm)}</span>`,
      iconSize: null,
    });
    const pop = document.createElement("div");
    pop.className = "map-pop";
    pop.textContent = `${st.name}: ${fmt(st.mm)} mm today, ${fmt(st.rate)} mm/h now`;
    L.marker(st.pos, { icon, title: `${st.name}: rain today`, keyboard: false }).bindPopup(pop).addTo(stationLayer);
  }

  list.replaceChildren(
    ...ranked.map(({ spot, near, risk }) => {
      const li = document.createElement("li");
      li.className = `risk-${risk.id}`;
      li.tabIndex = 0;
      li.innerHTML = "<span></span><b></b><small></small>";
      li.querySelector("span").textContent = `${spot.kind === "subway" ? "Subway · " : ""}${spot.name}`;
      li.querySelector("b").textContent = near ? `${fmt(near.mm)} mm` : "–";
      li.querySelector("small").textContent = near
        ? `${risk.label} · ${fmt(near.rate)} mm/h now · ${near.name}, ${near.d.toFixed(1)} km`
        : risk.label;
      const go = () => {
        map.setView([spot.lat, spot.lon], 14);
        box.scrollIntoView({ behavior: "smooth", block: "center" });
      };
      li.addEventListener("click", go);
      li.addEventListener("keydown", (e) => e.key === "Enter" && go());
      return li;
    })
  );
  return ranked;
}

async function refresh() {
  const key = apiKey();
  if (!key) {
    draw();
    return say("Add your Wunderground API key under Wunderground → Manage stations to see the rain near each spot.", true);
  }
  say("Loading today's rain at the stations…");
  const { fresh, reached, keyError } = await fetchAll(key);
  if (!reached) {
    const last = loadLast();
    if (last) readings = new Map(Object.entries(last.readings));
    draw();
    return say(last ? `No connection. Using readings saved at ${when(last.at)}.` : "No connection, and no saved readings yet.", true);
  }
  readings = fresh;
  loadedAt = Date.now();
  const ranked = draw();
  if (keyError) return say("Wunderground didn't accept the API key. Check it under Wunderground → Manage stations.", true);
  const high = ranked.filter((r) => r.risk.id === "high").length;
  const watch = ranked.filter((r) => r.risk.id === "watch").length;
  say(
    `Updated ${new Date().toLocaleTimeString()} · ${
      high || watch
        ? `${high} spot${high === 1 ? "" : "s"} likely flooded, ${watch} to watch`
        : "no spot has heavy rain near it today"
    }.`
  );
}

export function initFloods() {
  $("flood-refresh").addEventListener("click", refresh);
  $("flood-add").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name || !map) return;
    const c = map.getCenter();
    const spots = loadMine();
    spots.push({ name, lat: +c.lat.toFixed(5), lon: +c.lng.toFixed(5) });
    saveMine(spots);
    nameInput.value = "";
    draw();
    say(`Added “${name}” at the cross. Tap it on the map to remove it.`);
  });
}

export async function showFloods() {
  try {
    L = await loadLeaflet();
  } catch (e) {
    return say(`Couldn't open the map (${e.message}).`, true);
  }
  if (!map) {
    map = L.map(box, { zoomControl: true }).setView(CHENNAI, 11);
    addTiles(L, map, box);
    stationLayer = L.layerGroup().addTo(map);
    spotLayer = L.layerGroup().addTo(map);
  }
  setTimeout(() => map.invalidateSize(), 0);
  if (!readings.size) {
    const last = loadLast();
    if (last) readings = new Map(Object.entries(last.readings));
  }
  draw();
  if (Date.now() - loadedAt > TTL) refresh();
}
