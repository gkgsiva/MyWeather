// My places (#myplaces): save your own places (a village, a street, your
// farm), by name, pincode, your location or a tap on the map. Each one has its
// own Model charts (open Model charts with the place chosen) and its own rain
// history: the daily rain of the last 30 days, from Open-Meteo (free, no key).
// Rain days here are calendar days, midnight to midnight IST; the figures are
// Open-Meteo's analysis for that spot, not a rain gauge.
import { searchPlaces } from "./places.js";
import { savedPlaces, addPlace, removePlace, renamePlace, inModelGrid, MAX_PLACES } from "./placestore.js";
import { drawBars } from "./chart.js";
import { idbGet, idbPut } from "./idb.js";
import { loadLeaflet, addTiles } from "./stationmap.js";

const $ = (id) => document.getElementById(id);
const DAYS = 30;
const FRESH_MS = 60 * 60 * 1000;
const SEL = "myweather.places.selected";
let current = null; // the selected place id
let map = null;
let L = null;
let marker = null;
let run = 0;

const r1 = (v) => (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10);
const day = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

function say(text, error = false) {
  const s = $("mp-status");
  s.textContent = text;
  s.className = error ? "status error" : "status";
}

/** { at, days: [{ date, mm }] } for the last 30 days up to today, cached an hour. */
export async function rainHistory(p, force = false) {
  const key = `places.rain.${p.lat.toFixed(2)},${p.lon.toFixed(2)}`;
  const hit = await idbGet("misc", key);
  if (!force && hit && Date.now() - hit.at < FRESH_MS) return hit;
  const q = new URLSearchParams({
    latitude: String(p.lat),
    longitude: String(p.lon),
    daily: "precipitation_sum",
    past_days: String(DAYS - 1),
    forecast_days: "1",
    timezone: "Asia/Kolkata",
  });
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`);
    if (res.status === 429) throw new Error("limit");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    const t = j?.daily?.time || [];
    const v = j?.daily?.precipitation_sum || [];
    const out = { at: Date.now(), days: t.map((date, i) => ({ date, mm: typeof v[i] === "number" ? v[i] : null })) };
    if (!out.days.length) throw new Error("no data");
    await idbPut("misc", key, out);
    return out;
  } catch (e) {
    if (hit) return { ...hit, stale: true };
    throw e;
  }
}

function pref(k) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

// ---- The list ----

function renderList() {
  const list = savedPlaces();
  const ul = $("mp-list");
  $("mp-empty").hidden = list.length > 0;
  $("mp-count").textContent = list.length ? `${list.length} of ${MAX_PLACES}` : "";
  if (!list.some((p) => p.id === current)) current = list.find((p) => p.id === pref(SEL))?.id || list[0]?.id || null;
  ul.replaceChildren(
    ...list.map((p) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.className = "rank-row";
      b.setAttribute("aria-pressed", String(p.id === current));
      b.innerHTML = '<span class="rank-name"></span>';
      b.firstChild.textContent = p.name;
      b.addEventListener("click", () => select(p.id));
      li.append(b);
      return li;
    })
  );
  renderDetail();
}

function select(id) {
  current = id;
  try {
    localStorage.setItem(SEL, id);
  } catch {}
  renderList();
}

function renderDetail() {
  const p = savedPlaces().find((x) => x.id === current);
  $("mp-detail").hidden = !p;
  marker?.remove();
  marker = null;
  if (!p) return;
  $("mp-name").value = p.name;
  $("mp-where").textContent = `${p.lat.toFixed(3)}° N, ${p.lon.toFixed(3)}° E`;
  $("mp-title").textContent = p.name;
  const inGrid = inModelGrid(p.lat, p.lon);
  $("mp-open").hidden = !inGrid;
  $("mp-nomodels").hidden = inGrid;
  if (map) {
    marker = L.circleMarker([p.lat, p.lon], { radius: 7, color: "#000", weight: 2, fillColor: "#fff", fillOpacity: 1 }).addTo(map);
    map.setView([p.lat, p.lon], Math.max(map.getZoom(), 9));
  }
  loadRain(p, false);
}

async function loadRain(p, force) {
  const my = ++run;
  const svg = $("mp-chart");
  $("mp-readout").textContent = "";
  say("Loading rain history…");
  try {
    const h = await rainHistory(p, force);
    if (my !== run) return;
    const days = h.days;
    const bars = days.map((d, i) => ({
      tick: i % 5 === days.length % 5 ? String(Number(d.date.slice(8))) : "",
      value: d.mm ?? undefined,
      text: `${day(d.date)}: ${d.mm == null ? "no data" : `${r1(d.mm)} mm`}`,
    }));
    drawBars(svg, $("mp-readout"), bars, "Tap a day for its rain.", { unit: "mm/day" });
    const sum = (n) => days.slice(-n).reduce((a, d) => a + (d.mm || 0), 0);
    const wet = days.filter((d) => (d.mm || 0) >= 2.5).length;
    const best = days.reduce((a, d) => ((d.mm || 0) > (a?.mm || 0) ? d : a), null);
    $("mp-sums").innerHTML =
      `<div><b>${r1(sum(7))} mm</b><small>last 7 days</small></div>` +
      `<div><b>${r1(sum(DAYS))} mm</b><small>last 30 days</small></div>` +
      `<div><b>${wet}</b><small>rainy days (2.5 mm+)</small></div>` +
      `<div><b>${best && best.mm > 0 ? r1(best.mm) + " mm" : "–"}</b><small>${best && best.mm > 0 ? "wettest, " + day(best.date) : "wettest day"}</small></div>`;
    say(h.stale ? "Showing the saved rain history; couldn't update just now." : "");
  } catch (e) {
    if (my !== run) return;
    svg.replaceChildren();
    $("mp-sums").replaceChildren();
    say(e.message === "limit" ? "The weather service's daily limit is reached. Try again later." : /Failed to fetch|NetworkError|Load failed/.test(e.message) ? "No connection, and no saved rain history for this place yet." : `Couldn't load the rain history (${e.message}).`, true);
  }
}

// ---- Adding ----

function add(f) {
  const p = addPlace(f);
  if (!p) return say(`You can save up to ${MAX_PLACES} places. Remove one first.`, true);
  say("");
  select(p.id);
  return p;
}

async function find() {
  const q = $("mp-q").value.trim();
  const list = $("mp-results");
  if (q.length < 2) return list.replaceChildren();
  const li = (t) => Object.assign(document.createElement("li"), { textContent: t });
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
        b.innerHTML = '<span class="rank-name"></span>';
        b.firstChild.textContent = `${f.name}${f.detail ? ` · ${f.detail}` : ""}`;
        b.addEventListener("click", () => {
          $("mp-q").value = "";
          list.replaceChildren();
          add({ name: f.name, lat: f.lat, lon: f.lon });
        });
        row.append(b);
        return row;
      })
    );
  } catch (e) {
    list.replaceChildren(li(/Failed to fetch|NetworkError|Load failed/.test(e.message) ? "Couldn't search just now. Check the connection." : `Couldn't search (${e.message}).`));
  }
}

function useGps() {
  if (!navigator.geolocation) return say("This phone can't share its location.", true);
  say("Finding your location…");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      say("");
      add({ name: "My location", lat: pos.coords.latitude, lon: pos.coords.longitude });
    },
    (err) => say(`Couldn't get your location (${err.message}).`, true),
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 5 * 60 * 1000 }
  );
}

async function ensureMap() {
  if (map) return;
  try {
    L = await loadLeaflet();
  } catch (e) {
    $("mp-map").textContent = `Couldn't open the map (${e.message}).`;
    return;
  }
  const box = $("mp-map");
  map = L.map(box, { zoomControl: true }).setView([13.08, 80.27], 7);
  addTiles(L, map, box);
  map.on("click", (e) => {
    if (add({ name: "Map spot", lat: e.latlng.lat, lon: e.latlng.lng })) $("mp-name").focus();
  });
  renderDetail();
}

export function initMyPlaces() {
  $("mp-go").addEventListener("click", find);
  $("mp-q").addEventListener("keydown", (e) => {
    if (e.key === "Enter") find();
  });
  $("mp-gps").addEventListener("click", useGps);
  $("mp-name").addEventListener("change", () => {
    renamePlace(current, $("mp-name").value);
    renderList();
  });
  $("mp-remove").addEventListener("click", () => {
    if (!current) return;
    removePlace(current);
    current = null;
    renderList();
  });
  $("mp-refresh").addEventListener("click", () => {
    const p = savedPlaces().find((x) => x.id === current);
    if (p) loadRain(p, true);
  });
  $("mp-open").addEventListener("click", () => {
    try {
      localStorage.setItem("myweather.models.place", `p:${current}`);
    } catch {}
    location.hash = "#models";
  });
  window.addEventListener("myweather:places", () => {
    if ($("view-myplaces").hidden === false) renderList();
  });
}

export function showMyPlaces() {
  renderList();
  ensureMap();
  setTimeout(() => map?.invalidateSize(), 0);
}
