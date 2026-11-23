// Neighbourhood weather (#weatherunion): temperature, humidity, wind and rain
// for 16 areas of Chennai, from Weather Union's automatic weather stations
// (weatherunion.com).
//
// Weather Union's API needs a key, so the app never calls it. The "Weather
// Union readings" workflow (.github/workflows/weather-union.yml, key in the
// repository secret WEATHER_UNION_KEY) reads it every 30 minutes with
// scripts/weather_union.py and puts latest.json and history.json on the `data`
// branch; this screen reads those from raw.githubusercontent.com. The last
// reading is kept on the phone for offline use. Share comes from data-share
// (js/snap.js), so the picture follows Settings → Shared pictures.
import { when } from "./offline.js";
import { toTemp, tempUnit } from "./prefs.js";
import { drawLines } from "./chart.js";

export const DATA = "https://raw.githubusercontent.com/gkgsiva/MyWeather/data/weatherunion/";
const SAVED_KEY = "myweather.weatherunion.latest";
const TTL = 10 * 60 * 1000;
const STALE = 3 * 3600 * 1000;
const RAIN_ON = 0.01; // mm/min counted as raining

const $ = (id) => document.getElementById(id);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const f1 = (v) => (isNum(v) ? v.toFixed(1) : "–");
const PTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const compass = (d) => (isNum(d) ? PTS[Math.round((((d % 360) + 360) % 360) / 22.5) % 16] : "");

let data = null; // { at, readings }
let history = null;
let loadedAt = 0;
let run = 0;

function say(text, error = false) {
  const s = $("wu-status");
  s.textContent = text;
  s.className = error ? "status error" : "status";
}

const raining = (r) => isNum(r.rain) && r.rain >= RAIN_ON;
const rainTxt = (r) => {
  if (!isNum(r.rain) && !isNum(r.rainTotal)) return "–";
  const now = raining(r) ? `${f1(r.rain * 60)} mm/h` : "dry";
  return isNum(r.rainTotal) ? `${now} · ${f1(r.rainTotal)} mm` : now;
};

function sorted(list) {
  const how = $("wu-sort").value;
  const key = { temp: (r) => -(r.temp ?? -99), rain: (r) => -((r.rain ?? 0) * 1000 + (r.rainTotal ?? 0)), name: () => 0 }[how];
  return [...list].sort((a, b) => key(a) - key(b) || a.name.localeCompare(b.name));
}

function tile(label, r, text) {
  const el = document.createElement("div");
  el.className = "sc-tile";
  el.innerHTML = `<p class="sc-tile-name"></p><p class="sc-tile-sub"></p><p class="sc-big"><b></b></p>`;
  el.querySelector(".sc-tile-name").textContent = label;
  el.querySelector(".sc-tile-sub").textContent = r ? r.name : "";
  el.querySelector("b").textContent = r ? text : "–";
  return el;
}

function render() {
  const list = data?.readings || [];
  const age = data ? Date.now() - Date.parse(data.at) : 0;
  const stamp = data ? new Date(data.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";
  $("wu-sub").textContent = data ? `Weather Union stations · read ${stamp}` : "";
  const withT = list.filter((r) => isNum(r.temp));
  const hot = withT.reduce((a, r) => (!a || r.temp > a.temp ? r : a), null);
  const cool = withT.reduce((a, r) => (!a || r.temp < a.temp ? r : a), null);
  const wet = list.filter((r) => isNum(r.rainTotal)).reduce((a, r) => (!a || r.rainTotal > a.rainTotal ? r : a), null);
  const nRain = list.filter(raining).length;
  const tiles = $("wu-tiles");
  tiles.replaceChildren(
    tile("Hottest", hot, hot ? `${Math.round(toTemp(hot.temp))}${tempUnit()}` : ""),
    tile("Coolest", cool, cool ? `${Math.round(toTemp(cool.temp))}${tempUnit()}` : ""),
    tile("Raining now", null, ""),
    tile("Most rain today", wet, wet ? `${f1(wet.rainTotal)} mm` : ""),
  );
  const rt = tiles.children[2];
  rt.querySelector(".sc-tile-sub").textContent = list.length ? `${nRain} of ${list.length} areas` : "";
  rt.querySelector("b").textContent = list.length ? (nRain ? "Yes" : "No") : "–";
  const ul = $("wu-rows");
  ul.replaceChildren();
  for (const r of sorted(list)) {
    const li = document.createElement("li");
    li.className = `wu-row${raining(r) ? " wu-wet" : ""}`;
    const wind = isNum(r.wind) ? `${f1(r.wind * 3.6)} km/h ${compass(r.dir)}`.trim() : "–";
    li.innerHTML = `<b class="wu-name"></b><span class="wu-t"></span><span class="wu-m"></span>`;
    li.querySelector(".wu-name").textContent = r.name;
    li.querySelector(".wu-t").textContent = isNum(r.temp) ? `${f1(toTemp(r.temp))}${tempUnit()}` : "–";
    li.querySelector(".wu-m").textContent = `${isNum(r.humidity) ? Math.round(r.humidity) + "%" : "–"} · ${wind} · ${rainTxt(r)}`;
    ul.append(li);
  }
  $("wu-wrap").hidden = !list.length;
  if (data && age > STALE) say(`Last reading was ${when(Date.parse(data.at))}; the workflow hasn't updated since.`, true);
  drawTrend();
}

function drawTrend() {
  const wrap = $("wu-trend-wrap");
  const rows = (history?.areas?.[$("wu-area").value] || []).filter((r) => isNum(r[1]));
  if (rows.length < 3) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  const vals = rows.map((r) => toTemp(r[1]));
  const min = Math.floor(Math.min(...vals)) - 1;
  const max = min + 2 * Math.ceil((Math.max(...vals) + 1 - min) / 2);
  const hm = (r) => new Date(r[0]).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  const ticks = rows.map((r, k) => (k % 8 === (rows.length - 1) % 8 ? { at: k, label: hm(r) } : null)).filter(Boolean);
  drawLines(
    $("wu-trend"),
    $("wu-readout"),
    {
      count: rows.length,
      series: [{ values: vals }],
      ticks,
      points: rows.map((r, k) => ({
        at: k,
        text: `${hm(r)} · ${f1(vals[k])}${tempUnit()}${isNum(r[2]) ? ` · humidity ${Math.round(r[2])}%` : ""}${isNum(r[3]) && r[3] >= RAIN_ON ? ` · raining ${f1(r[3] * 60)} mm/h` : ""}`,
      })),
    },
    "Tap the chart for any reading.",
    { unit: tempUnit(), min, max },
  );
}

function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(SAVED_KEY));
  } catch {
    return null;
  }
}

async function getJson(name) {
  const r = await fetch(`${DATA}${name}?t=${Math.floor(Date.now() / 60000)}`, { cache: "no-store" });
  if (r.status === 404) throw new Error("not published yet");
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function fillAreas() {
  const pick = $("wu-area");
  if (pick.options.length || !data) return;
  for (const r of data.readings) pick.add(new Option(r.name, r.name));
}

async function refresh(force = false) {
  const myRun = ++run;
  if (!data) {
    const saved = loadSaved();
    if (saved?.data) {
      data = saved.data;
      history = saved.history || null;
      fillAreas();
      render();
      say(`Saved reading from ${when(saved.at)}.`);
    }
  }
  if (!force && data && Date.now() - loadedAt < TTL) return;
  say("Loading Weather Union readings…");
  try {
    const [d, h] = await Promise.all([getJson("latest.json"), getJson("history.json").catch(() => null)]);
    if (myRun !== run) return;
    data = d;
    history = h;
    loadedAt = Date.now();
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify({ at: loadedAt, data, history }));
    } catch {}
    fillAreas();
    render();
    if (Date.now() - Date.parse(data.at) <= STALE) say(`Updated ${when(Date.parse(data.at))}.`);
  } catch (e) {
    if (myRun !== run) return;
    say(data ? `Couldn't refresh (${e.message}); showing the saved reading.` : `Couldn't load Weather Union readings (${e.message}).`, true);
  }
}

export function initWeatherUnion() {
  $("wu-refresh").addEventListener("click", () => refresh(true));
  $("wu-sort").addEventListener("change", render);
  $("wu-area").addEventListener("change", drawTrend);
}

export function showWeatherUnion() {
  refresh();
}
