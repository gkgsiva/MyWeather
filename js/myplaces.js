// My places (#myplaces): save your own places (a village, a street, your
// farm), by name, pincode, your location or a tap on the map. Each one has its
// own Model charts (open Model charts with the place chosen) and its own rain
// history: the daily rain of the last 30 days, from Open-Meteo (free, no key).
// Rain days here are calendar days, midnight to midnight IST; the figures are
// Open-Meteo's analysis for that spot, not a rain gauge. Above it: the weather
// now, 7 days back and 7 ahead (js/placeweather.js) and the nearest TN-SMART
// rain gauge within 15 km, with what it measured.
import { searchPlaces } from "./places.js";
import { savedPlaces, addPlace, removePlace, renamePlace, inModelGrid, MAX_PLACES } from "./placestore.js";
import { drawBars, drawLines } from "./chart.js";
import { idbGet, idbPut } from "./idb.js";
import { loadLeaflet, addTiles } from "./stationmap.js";
import { placeWeather, nearestGauge, GAUGE_KM, niceDay } from "./placeweather.js";
import { code } from "./forecast.js";
import { when } from "./offline.js";
import { toTemp, tempUnit, toWind, windUnit } from "./prefs.js";

const $ = (id) => document.getElementById(id);
const DAYS = 30;
const FRESH_MS = 60 * 60 * 1000;
const SEL = "myweather.places.selected";
let current = null; // the selected place id
let map = null;
let L = null;
let marker = null;
let run = 0;
let runWx = 0;
let runGauge = 0;

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
  $("mp-title-t").textContent = p.name;
  const inGrid = inModelGrid(p.lat, p.lon);
  $("mp-open").hidden = !inGrid;
  $("mp-nomodels").hidden = inGrid;
  if (map) {
    marker = L.circleMarker([p.lat, p.lon], { radius: 7, color: "#000", weight: 2, fillColor: "#fff", fillOpacity: 1 }).addTo(map);
    map.setView([p.lat, p.lon], Math.max(map.getZoom(), 9));
  }
  loadRain(p, false);
  loadWx(p, false);
  loadGauge(p, false);
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const compass = (deg) => (typeof deg === "number" ? COMPASS[Math.round(deg / 45) % 8] : "");
const num = (v) => (typeof v === "number" ? String(Math.round(v)) : "–");
const t0 = (c) => num(toTemp(c));
const w0 = (kmh) => num(toWind(kmh));
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dayName = (iso) => WD[new Date(`${iso}T00:00:00Z`).getUTCDay()];
const offline = (e) => /Failed to fetch|NetworkError|Load failed/.test(e.message);

function sayWx(text, error = false) {
  const s = $("mp-wx-status");
  s.textContent = text;
  s.className = error ? "status error" : "status";
}

function dayRow(d, i, past) {
  const li = document.createElement("li");
  const rain = d.precipitation_sum[i];
  const chance = d.precipitation_probability_max[i];
  li.innerHTML = `
    <span class="fc-day"><b></b><small></small></span>
    <span class="fc-icon" aria-hidden="true"></span>
    <span class="fc-text"><span></span><small></small></span>
    <span class="fc-temp"><b></b> <small></small></span>
    <span class="fc-rain"><b></b><small></small></span>`;
  const q = (s) => li.querySelector(s);
  const date = d.time[i];
  q(".fc-day b").textContent = i === 7 ? "Today" : dayName(date);
  q(".fc-day small").textContent = niceDay(date);
  const [icon, text] = code(d.weather_code[i]);
  q(".fc-icon").textContent = icon;
  q(".fc-text span").textContent = text;
  q(".fc-text small").textContent =
    `Wind ${w0(d.wind_speed_10m_max[i])}, gusts ${w0(d.wind_gusts_10m_max[i])} ${windUnit()} · Humidity ${num(d.relative_humidity_2m_mean[i])}%`;
  q(".fc-temp b").textContent = `${t0(d.temperature_2m_max[i])}°`;
  q(".fc-temp small").textContent = `${t0(d.temperature_2m_min[i])}°`;
  if (past) {
    q(".fc-rain b").textContent = typeof rain === "number" ? `${r1(rain)} mm` : "–";
    q(".fc-rain small").textContent = "rain";
  } else {
    q(".fc-rain b").textContent = `${num(chance)}%`;
    q(".fc-rain small").textContent = `${typeof rain === "number" ? r1(rain) : "–"} mm`;
    if (chance >= 70) li.classList.add("wet");
  }
  return li;
}

function renderWx(w) {
  const { current: c, daily: d } = w.data;
  // Index 7 is today: 7 days back, today, then 7 ahead.
  if (c) {
    const [icon, text] = code(c.weather_code);
    const big = document.createElement("div");
    big.className = "now-big";
    big.textContent = `${icon} ${t0(c.temperature_2m)}°`;
    const desc = document.createElement("div");
    desc.className = "now-desc";
    desc.innerHTML = "<strong></strong><span></span><small></small>";
    desc.children[0].textContent = text;
    desc.children[1].textContent = `Feels ${t0(c.apparent_temperature)}° · Humidity ${num(c.relative_humidity_2m)}% · Wind ${w0(c.wind_speed_10m)} ${windUnit()} ${compass(c.wind_direction_10m)}`;
    desc.children[2].textContent = `Today ${t0(d.temperature_2m_max[7])}° / ${t0(d.temperature_2m_min[7])}° · ${num(d.precipitation_probability_max[7])}% chance of rain, ${typeof d.precipitation_sum[7] === "number" ? r1(d.precipitation_sum[7]) : "–"} mm`;
    $("mp-now").replaceChildren(big, desc);
  }
  const n = d.time.length;
  const hi = d.temperature_2m_max.map((v) => (typeof v === "number" ? toTemp(v) : null));
  const lo = d.temperature_2m_min.map((v) => (typeof v === "number" ? toTemp(v) : null));
  const vals = [...hi, ...lo].filter((v) => typeof v === "number");
  const step = Math.max(...vals) - Math.min(...vals) > 12 ? 5 : 2;
  const min = Math.floor(Math.min(...vals) / step) * step;
  const max = Math.max(min + 4 * step, Math.ceil(Math.max(...vals) / step) * step);
  drawLines(
    $("mp-temp"),
    $("mp-temp-readout"),
    {
      count: n,
      series: [
        { values: hi, cls: "s2" },
        { values: lo, cls: "s1" },
      ],
      ticks: d.time.map((t, i) => ({ at: i, label: i % 2 === 1 ? "" : String(Number(t.slice(8))) })).filter((t) => t.label),
      points: d.time.map((t, i) => ({
        at: i,
        text: `${i === 7 ? "Today" : dayName(t)} ${niceDay(t)}${i < 7 ? " (past)" : ""}: highest ${t0(d.temperature_2m_max[i])}°, lowest ${t0(d.temperature_2m_min[i])}° · rain ${typeof d.precipitation_sum[i] === "number" ? r1(d.precipitation_sum[i]) + " mm" : "–"}`,
      })),
    },
    "Tap a day for its temperature.",
    { unit: tempUnit(), min, max, now: 7 }
  );
  const past = (k) => d[k].slice(0, 7).filter((v) => typeof v === "number");
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const hot = Math.max(...past("temperature_2m_max"));
  const cold = Math.min(...past("temperature_2m_min"));
  const rain7 = past("precipitation_sum").reduce((x, y) => x + y, 0);
  const ahead = d.precipitation_sum.slice(8, 15).reduce((x, y) => x + (y || 0), 0);
  $("mp-temp-sums").innerHTML =
    `<div><b>${t0(hot)}°</b><small>hottest, last 7 days</small></div>` +
    `<div><b>${t0(cold)}°</b><small>coolest night, last 7 days</small></div>` +
    `<div><b>${num(avg(past("relative_humidity_2m_mean")))}%</b><small>humidity, 7-day average</small></div>` +
    `<div><b>${r1(ahead)} mm</b><small>rain expected, next 7 days</small></div>` +
    `<div><b>${r1(rain7)} mm</b><small>rain, last 7 days (analysis)</small></div>`;
  $("mp-days").replaceChildren(...d.time.map((_, i) => i).filter((i) => i >= 7).map((i) => dayRow(d, i, false)));
  $("mp-past").replaceChildren(...d.time.map((_, i) => i).filter((i) => i < 7).reverse().map((i) => dayRow(d, i, true)));
}

async function loadWx(p, force) {
  const my = ++runWx;
  sayWx("Loading the weather…");
  try {
    const w = await placeWeather(p, force);
    if (my !== runWx) return;
    renderWx(w);
    sayWx(w.stale ? `Couldn't update just now. Showing the weather saved at ${when(w.at)}.` : "", !!w.stale);
  } catch (e) {
    if (my !== runWx) return;
    for (const id of ["mp-now", "mp-temp", "mp-temp-sums", "mp-days", "mp-past"]) $(id).replaceChildren();
    sayWx(e.message === "limit" ? "The weather service's daily limit is reached. Try again later." : offline(e) ? "No connection, and no saved weather for this place yet." : `Couldn't load the weather (${e.message}).`, true);
  }
}

function sayGauge(text, error = false) {
  const s = $("mp-gauge-status");
  s.textContent = text;
  s.className = error ? "status error" : "status";
}

async function loadGauge(p, force) {
  const my = ++runGauge;
  const svg = $("mp-gauge");
  const line = $("mp-gauge-line");
  svg.replaceChildren();
  svg.hidden = true;
  $("mp-gauge-readout").textContent = "";
  line.textContent = "";
  sayGauge("Finding the nearest rain gauge…");
  try {
    const g = await nearestGauge(p, force);
    if (my !== runGauge) return;
    sayGauge(g.stale ? `Couldn't update just now. Showing the gauge reading saved at ${when(g.at)}.` : "", !!g.stale);
    if (g.none) {
      line.textContent = g.nearest
        ? `No rain gauge within ${GAUGE_KM} km of this place. The nearest, ${g.nearest.name} (${g.nearest.district}), is ${g.nearest.km.toFixed(1)} km away, too far to stand for it.`
        : "No rain gauge data to compare.";
      return;
    }
    const x = g.gauge;
    svg.hidden = false;
    const last = x.days[x.days.length - 1];
    line.textContent =
      `${x.name} (${x.district}), ${x.km < 1 ? "under 1" : x.km.toFixed(1)} km away. ` +
      `${typeof last.mm === "number" ? `${r1(last.mm)} mm since 8:30 AM` : "No reading yet for the rain day running now"}.`;
    drawBars(
      svg,
      $("mp-gauge-readout"),
      x.days.map((d) => ({
        tick: niceDay(d.day, { day: "numeric" }),
        value: d.mm ?? undefined,
        text: `Rain day ending ${niceDay(d.day)}, 8:30 AM: ${d.mm == null ? "no reading" : `${r1(d.mm)} mm`}${d === last ? " (running, not finished)" : ""}`,
      })),
      "Tap a day for the gauge's rain.",
      { unit: "mm/day" }
    );
  } catch (e) {
    if (my !== runGauge) return;
    sayGauge(offline(e) ? "No connection, and no saved gauge reading for this place yet." : `Couldn't read the rain gauges (${e.message}).`, true);
  }
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
    if (!p) return;
    loadRain(p, true);
    loadWx(p, true);
    loadGauge(p, true);
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
