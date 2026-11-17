// Cyclone watch: the current depression or cyclone on one screen, laid out
// like a forecaster's infographic: a headline with IMD's landfall, a track
// map, and short panels. Everything shown is fetched, nothing is made up:
//
// - IMD's newest National Bulletin, read every hour by the "IMD cyclone
//   bulletin" workflow into cyclone/latest.json and history.json on the data
//   branch (name, stage, position, landfall sentence, forecast table,
//   warnings by state) and IMD's track picture with its cone (track.jpg).
// - IMD's observed and forecast track lines from its map server
//   (cyclonetrack.js; inside the Android app, which adds the CORS header).
// - Model tracks and GFS steering from Open-Meteo (cyclonemodels.js).
// - The MJO index (cyclone/mjo.json, from Australia's Bureau of Meteorology).
// - Past storms: a fixed list of where well-known storms crossed the coast.
//
// - Every other active tropical cyclone in the world (cyclone/world.json from
//   NOAA's National Hurricane Center, the Joint Typhoon Warning Center and
//   GDACS), picked from a world map; the same panels, credited to the agency.
//
// When nothing is active anywhere, it says so and keeps the MJO and the past
// storms.
import { km } from "./geo.js";
import { when } from "./offline.js";
import { fetchTrack } from "./cyclonetrack.js";
import { loadLeaflet } from "./stationmap.js";
import { placeNamed, shoreBetween, shoreAround, nearestPlace, meetsCoast, closestOnSegment } from "./coast.js";
import { MODELS, modelTracks, steering, compass, landTest } from "./cyclonemodels.js";
import { showTrackHistory } from "./cyclonetrackhistory.js";
import { resizeTrackMap } from "./cyclonetrackmap.js";

export const DATA = "https://raw.githubusercontent.com/gkgsiva/MyWeather/data/cyclone/";
const SAVED = "myweather.cyclonewatch.last";
const MODEL_CACHE = "myweather.cyclonewatch.models";
const MODEL_TTL = 3 * 3600 * 1000;
const ACTIVE_HOURS = 30; // a bulletin newer than this means a live system
const CHENNAI = [13.08, 80.27];

const $ = (id) => document.getElementById(id);

// Where well-known storms crossed the coast (IMD's reports). Peak = IMD's
// highest stage for the storm.
const PAST = [
  { name: "Fengal", date: "2024-11-30", peak: "CS", near: "Puducherry", lat: 11.98, lon: 79.85 },
  { name: "Dana", date: "2024-10-25", peak: "SCS", near: "Bhitarkanika–Dhamra, Odisha", lat: 20.75, lon: 86.95 },
  { name: "Michaung", date: "2023-12-05", peak: "SCS", near: "Bapatla, Andhra Pradesh", lat: 15.85, lon: 80.5 },
  { name: "Mandous", date: "2022-12-09", peak: "SCS", near: "Mamallapuram", lat: 12.62, lon: 80.2 },
  { name: "Gulab", date: "2021-09-26", peak: "CS", near: "Kalingapatnam, Andhra Pradesh", lat: 18.4, lon: 84.15 },
  { name: "Nivar", date: "2020-11-25", peak: "VSCS", near: "Puducherry", lat: 12.05, lon: 79.9 },
  { name: "Fani", date: "2019-05-03", peak: "ESCS", near: "Puri, Odisha", lat: 19.8, lon: 85.83 },
  { name: "Phethai", date: "2018-12-17", peak: "SCS", near: "Katrenikona (Yanam–Kakinada)", lat: 16.6, lon: 82.2 },
  { name: "Gaja", date: "2018-11-16", peak: "VSCS", near: "Nagapattinam–Vedaranyam", lat: 10.55, lon: 79.85 },
  { name: "Titli", date: "2018-10-11", peak: "VSCS", near: "Palasa, Andhra Pradesh", lat: 18.75, lon: 84.5 },
  { name: "Vardah", date: "2016-12-12", peak: "VSCS", near: "Chennai", lat: 13.1, lon: 80.3 },
  { name: "Hudhud", date: "2014-10-12", peak: "VSCS", near: "Visakhapatnam", lat: 17.7, lon: 83.3 },
  { name: "Helen", date: "2013-11-22", peak: "SCS", near: "Machilipatnam", lat: 16.1, lon: 81.15 },
  { name: "Phailin", date: "2013-10-12", peak: "VSCS", near: "Gopalpur, Odisha", lat: 19.25, lon: 84.9 },
  { name: "Nilam", date: "2012-10-31", peak: "CS", near: "Mamallapuram", lat: 12.6, lon: 80.2 },
  { name: "Thane", date: "2011-12-30", peak: "VSCS", near: "Cuddalore–Puducherry", lat: 11.85, lon: 79.8 },
  { name: "Laila", date: "2010-05-20", peak: "SCS", near: "Bapatla, Andhra Pradesh", lat: 15.85, lon: 80.5 },
];
const SHORT = {
  "Low Pressure Area": "LPA",
  "Well Marked Low Pressure Area": "WML",
  Depression: "D",
  "Deep Depression": "DD",
  "Cyclonic Storm": "CS",
  "Severe Cyclonic Storm": "SCS",
  "Very Severe Cyclonic Storm": "VSCS",
  "Extremely Severe Cyclonic Storm": "ESCS",
  "Super Cyclonic Storm": "SuCS",
};
const LONG = Object.fromEntries(Object.entries(SHORT).map(([k, v]) => [v, k]));
const COLOUR = { LPA: "#9e9e9e", WML: "#9e9e9e", D: "#4caf50", DD: "#8bc34a", CS: "#ffc107", SCS: "#ff9800", VSCS: "#f44336", ESCS: "#b71c1c", SuCS: "#6a1b9a" };
const stageColour = (s) => COLOUR[SHORT[s] || s] || "#9e9e9e";

let L = null;
let map = null;
let layers = {};
let loadedAt = 0;
let state = null; // { b, hist, mjo, wfs, world, active, mode, sel, models, steer, land }
let worldMap = null;
let worldLayer = null;
const PICK_KEY = "myweather.cyclonewatch.pick";

// ---- small helpers ----

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k === "html") e.innerHTML = v;
    else e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k instanceof Node ? k : String(k));
  return e;
}

const IST = { timeZone: "Asia/Kolkata" };
const fmtTime = (ms) =>
  new Date(ms).toLocaleString("en-IN", { ...IST, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
// "Tue 17, 2:30 pm", for tables.
const fmtShort = (ms) => {
  const d = new Date(ms);
  const day = d.toLocaleDateString("en-IN", { ...IST, weekday: "short", day: "numeric" });
  return `${day}, ${d.toLocaleTimeString("en-IN", { ...IST, hour: "numeric", minute: "2-digit" })}`;
};
const fmtDay = (iso) => new Date(`${iso}T12:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const round10 = (n) => Math.round(n / 10) * 10;
const dir8 = (from, to) => {
  const y = to[0] - from[0];
  const x = (to[1] - from[1]) * Math.cos((from[0] * Math.PI) / 180);
  return compass((Math.atan2(x, y) * 180) / Math.PI + 360);
};

function say(text, error = false) {
  const s = $("cw-status");
  s.textContent = text;
  s.className = error ? "status error" : "status";
}

async function getData(name) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    // raw.githubusercontent.com caches for 5 minutes; the bucket keeps the
    // phone's own cache from holding an older copy.
    const res = await fetch(`${DATA}${name}?t=${Math.floor(Date.now() / 300000)}`, { signal: ctrl.signal, cache: "no-cache" });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ---- reading the bulletin ----

// IMD's forecast points as { t (ms), lat, lon, wind, stage }.
function forecastPoints(b) {
  return (b?.forecast || []).map((r) => ({ ...r, t: Date.parse(r.at) })).filter((r) => Number.isFinite(r.t));
}

// Where a list of { t, lat, lon } first meets the coast.
function crossing(pts) {
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1];
    const q = pts[i];
    const hit = meetsCoast([p.lat, p.lon], [q.lat, q.lon]);
    if (hit) return { t: p.t + (q.t - p.t) * hit.f, lat: hit.pt[0], lon: hit.pt[1], before: i };
  }
  return null;
}

// IMD's "noon of 20th November, 2026" as a time (ms), or null. Parts of the day
// as IMD uses them, at their middle.
const DAY_PART = { "early hours": 3, morning: 8, forenoon: 10, noon: 12, afternoon: 15, evening: 18, night: 22, midnight: 0 };
function landfallTime(b) {
  const w = b?.landfall?.when;
  const m = /^(early hours|morning|forenoon|noon|afternoon|evening|night|midnight)\b.*?(\d{1,2})(?:st|nd|rd|th)?\s+([A-Z][a-z]+)(?:,?\s*(\d{4}))?/i.exec(w || "");
  if (!m) return null;
  const issued = new Date(Date.parse(b.issued) || Date.now());
  const year = m[4] ? +m[4] : issued.getFullYear();
  const t = Date.parse(`${m[2]} ${m[3]} ${year} ${String(DAY_PART[m[1].toLowerCase()]).padStart(2, "0")}:00 GMT+0530`);
  return Number.isFinite(t) ? t : null;
}

// Hour by hour along a track, the nearest it comes to a place.
function closest(pts, place) {
  let best = null;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1];
    const q = pts[i];
    const steps = Math.max(1, Math.round((q.t - p.t) / 3600000));
    for (let s = 0; s <= steps; s++) {
      const f = s / steps;
      const pt = [p.lat + (q.lat - p.lat) * f, p.lon + (q.lon - p.lon) * f];
      const d = km(pt, place);
      if (!best || d < best.km) best = { km: d, t: p.t + (q.t - p.t) * f, pt };
    }
  }
  return best;
}

// The position at time t along the track (null outside it).
function positionAt(pts, t) {
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1];
    const q = pts[i];
    if (t >= p.t && t <= q.t) {
      const f = (t - p.t) / (q.t - p.t || 1);
      return { t, lat: p.lat + (q.lat - p.lat) * f, lon: p.lon + (q.lon - p.lon) * f };
    }
  }
  return null;
}

// IMD's landfall zone as shore points: the stretch between the two places the
// bulletin names, or 60 km either side of the place it names or of where the
// forecast track meets the coast.
function landfallZone(b, fcCross) {
  const lf = b?.landfall || {};
  if (lf.between) {
    const shore = shoreBetween(lf.between[0], lf.between[1]);
    if (shore) return { shore, label: `${lf.between[0]} – ${lf.between[1]}` };
  }
  if (lf.near) {
    const p = placeNamed(lf.near);
    if (p) return { shore: shoreAround([p.lat, p.lon], 60, km), label: `near ${lf.near}` };
  }
  if (fcCross) {
    const p = nearestPlace([fcCross.lat, fcCross.lon], km);
    return { shore: shoreAround([fcCross.lat, fcCross.lon], 60, km), label: `near ${p.name}`, fromTrack: true };
  }
  return null;
}

function zoneMid(zone) {
  if (!zone?.shore?.length) return null;
  const s = zone.shore;
  // Halfway along the stretch.
  let total = 0;
  for (let i = 1; i < s.length; i++) total += km(s[i - 1], s[i]);
  let left = total / 2;
  for (let i = 1; i < s.length; i++) {
    const d = km(s[i - 1], s[i]);
    if (d >= left) {
      const f = d ? left / d : 0;
      return [s[i - 1][0] + (s[i][0] - s[i - 1][0]) * f, s[i - 1][1] + (s[i][1] - s[i - 1][1]) * f];
    }
    left -= d;
  }
  return s[0];
}

// How far a point is from the landfall zone's stretch of shore (0 inside it).
function zoneKm(zone, pt) {
  const s = zone?.shore || [];
  if (s.length < 2) return null;
  let best = Infinity;
  for (let i = 1; i < s.length; i++) best = Math.min(best, km(pt, closestOnSegment(pt, s[i - 1], s[i]).p));
  return best;
}

// The bulletin's lines for Tamil Nadu, Puducherry and Chennai.
const isTN = (r) => /tamil\s*nadu|puducherry|karaikal|chennai/i.test(`${r.region} ${r.text}`);

// ---- loading ----

async function refresh() {
  say("Loading IMD's latest bulletin…");
  let b = null;
  let hist = null;
  let mjo = null;
  let wfs = null;
  let saved = null;
  let world = null;
  let archive = null;
  const results = await Promise.allSettled([getData("latest.json"), getData("history.json"), getData("mjo.json"), fetchTrack(), getData("world.json"), getData("archive.json")]);
  [b, hist, mjo, wfs, world, archive] = results.map((r) => (r.status === "fulfilled" ? r.value : null));
  const offline = results[0].status === "rejected";
  if (offline) {
    try {
      saved = JSON.parse(localStorage.getItem(SAVED));
    } catch {}
    if (saved) ({ b, hist, mjo, world, archive } = saved);
  } else {
    try {
      localStorage.setItem(SAVED, JSON.stringify({ at: Date.now(), b, hist, mjo, world, archive }));
    } catch {}
  }
  const issued = Date.parse(b?.issued || "");
  const recent = Number.isFinite(issued) && Date.now() - issued < ACTIVE_HOURS * 3600 * 1000;
  const wfsLive = (wfs?.features || []).some((f) => f.geometry);
  const prev = state?.sel;
  state = { b, hist, mjo, wfs, world, archive, active: recent || (wfsLive && !!b), wfsLive, issued };
  state.sel = pickDefault(prev);
  loadedAt = Date.now();
  render();
  if (offline) {
    say(saved ? `No connection. Showing what was saved ${when(saved.at)}.` : "Couldn't load the cyclone data. Check the connection and try again.", true);
  } else if (!b && !world) {
    say("No cyclone data has been read yet.");
  } else {
    say(`Updated ${new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}`);
  }
  if (state.mode !== "calm") loadModels();
}

// ---- rendering ----

function show(id, on) {
  $(id).hidden = !on;
}

function render() {
  const storms = stormList();
  state.mode = !storms.length ? "calm" : state.sel === "imd" ? "imd" : "world";
  state.active = state.mode === "imd";
  state.models = null;
  state.steer = null;
  state.land = null;
  renderPicker(storms);
  showTrackHistory(state.archive, state.sel === "imd" ? (state.b?.system ? `imd:${state.b.system}` : null) : state.sel);
  if (state.mode === "world") {
    renderWorld(storms.find((x) => x.id === state.sel).s);
    return;
  }
  resetImdPanels();
  const { b, active } = state;
  renderHead();
  show("cw-mapbox", active);
  show("cw-p-glance", active);
  show("cw-p-fc", active && forecastPoints(b).length > 0);
  show("cw-p-tn", active);
  show("cw-p-models", active);
  show("cw-p-steer", active);
  show("cw-p-hist", active && histRows().length > 1);
  show("cw-p-img", active && !!b?.trackImage);
  if (active) {
    renderForecast();
    renderTN();
    renderHistory();
    renderGlance();
    $("cw-img").src = `${DATA}track.jpg?t=${encodeURIComponent(b.trackImage || "")}`;
    drawMap();
  }
  renderMjo();
  show("cw-p-past", true);
  renderPast();
}

function renderHead() {
  const { b, active, issued } = state;
  const chips = $("cw-chips");
  chips.replaceChildren();
  $("cw-head").classList.toggle("cw-calm", !active);
  if (!active) {
    $("cw-kicker").textContent = "India and around the world";
    $("cw-stage").textContent = "No active cyclone";
    $("cw-name").textContent = "";
    $("cw-alert").hidden = true;
    const lf = $("cw-landfall");
    lf.hidden = false;
    const imd = b
      ? `IMD has issued no bulletin since ${fmtTime(issued)} (${b.stage || "system"}${b.name ? ` ${b.name}` : ""}, ${b.system || ""}).`
      : "IMD has no depression or cyclone in its bulletins.";
    lf.textContent = `${imd} No hurricane, typhoon or cyclone is active anywhere else either (NHC, JTWC). This screen fills in when one forms.`;
    if (b?.outlook) {
      chips.append(el("a", { class: "cw-chip", href: b.outlook, target: "_blank", rel: "noopener noreferrer", text: "IMD's tropical weather outlook (PDF)" }));
    }
    return;
  }
  $("cw-kicker").textContent = `IMD National Bulletin No. ${b.no ?? "?"}${b.system ? ` (${b.system})` : ""} · issued ${fmtTime(issued)}`;
  $("cw-stage").textContent = b.stage || "Cyclone";
  $("cw-name").textContent = b.name ? b.name.toUpperCase() : "";
  const alert = $("cw-alert");
  alert.hidden = !b.alert;
  alert.textContent = b.alert || "";
  alert.className = `cw-alert ${b.colour ? `cw-${b.colour.toLowerCase()}` : ""}`;
  const lf = $("cw-landfall");
  lf.hidden = !b.landfall?.text;
  lf.replaceChildren(el("b", { text: "IMD landfall forecast: " }), b.landfall?.text || "");

  const pts = forecastPoints(b);
  const now = pts[0];
  if (now?.wind) chips.append(chip("Now", `${now.wind.min}–${now.wind.max} km/h, gusts ${now.wind.gust ?? "?"}`));
  const chen = (b.distances || []).find((d) => /chennai/i.test(d.place));
  if (chen) chips.append(chip("From Chennai", `${chen.km} km ${chen.dir}`));
  else if (b.lat) chips.append(chip("From Chennai", `${round10(km(CHENNAI, [b.lat, b.lon]))} km ${dir8(CHENNAI, [b.lat, b.lon])}`));
  if (b.movement) chips.append(chip("Motion", b.movement.replace(/^(\w)/, (c) => c.toUpperCase())));
  const near = closest(pts, CHENNAI);
  if (near && pts.length > 1) chips.append(chip("Closest to Chennai", `${round10(near.km)} km, ${fmtTime(near.t)}`));
  if (b.at) chips.append(chip("Position at", `${fmtTime(Date.parse(b.at))}: ${b.lat}°N ${b.lon}°E`));
}

function chip(label, value) {
  return el("span", { class: "cw-chip" }, el("small", { text: label }), el("b", { text: value }));
}

function renderForecast() {
  const { b } = state;
  const pts = forecastPoints(b);
  // The landfall row: IMD's own words and time when the bulletin has them,
  // otherwise where the track meets the coast on the app's map.
  const lf = b.landfall || {};
  const lt = landfallTime(b);
  const geo = crossing(pts);
  let cross = null;
  if (lt && (lf.between || lf.near)) {
    const where = lf.between ? `between ${lf.between.join(" and ")}` : `near ${lf.near}`;
    cross = { t: lt, text: `Landfall (IMD): ${lf.coast ? `${lf.coast} coast ` : ""}${where}` };
  } else if (geo) {
    const place = nearestPlace([geo.lat, geo.lon], km);
    cross = { t: geo.t, text: `Track meets the coast near ${place.name} (${place.state})` };
  }
  const t = $("cw-fc");
  const head = el("tr", {}, ...["When (IST)", "°N, °E", "Wind (gust)", "Stage", "Chennai"].map((h) => el("th", { text: h })));
  const rows = [];
  let crossShown = !cross;
  pts.forEach((p) => {
    if (!crossShown && p.t > cross.t) {
      crossShown = true;
      rows.push(el("tr", { class: "cw-cross" }, el("td", { text: `≈ ${fmtShort(cross.t)}` }), el("td", { colspan: "4", text: cross.text })));
    }
    const w = p.wind ? `${p.wind.min}–${p.wind.max}${p.wind.gust ? ` (${p.wind.gust})` : ""}` : "";
    rows.push(
      el(
        "tr",
        {},
        el("td", { text: fmtShort(p.t) }),
        el("td", { text: `${p.lat.toFixed(1)}, ${p.lon.toFixed(1)}` }),
        el("td", { class: "num", text: w }),
        el("td", {}, el("span", { class: "cw-stage", style: `--c:${stageColour(p.stage)}`, text: SHORT[p.stage] || p.stage || "" })),
        el("td", { class: "num", text: `${round10(km(CHENNAI, [p.lat, p.lon]))} km` })
      )
    );
  });
  if (!crossShown) rows.push(el("tr", { class: "cw-cross" }, el("td", { text: `≈ ${fmtShort(cross.t)}` }), el("td", { colspan: "4", text: cross.text })));
  t.replaceChildren(el("thead", {}, head), el("tbody", {}, rows));
}

function renderTN() {
  const { b } = state;
  const w = b.warnings || {};
  const box = $("cw-tn");
  const other = $("cw-other");
  const names = { rain: "Rain", wind: "Wind", sea: "Sea", surge: "Storm surge" };
  const tn = [];
  const rest = [];
  for (const [k, label] of Object.entries(names)) {
    for (const r of w[k] || []) (isTN(r) ? tn : rest).push({ label, ...r });
  }
  const chen = (b.distances || []).find((d) => /chennai/i.test(d.place));
  const pts = forecastPoints(b);
  const near = closest(pts, CHENNAI);
  const lines = [];
  if (chen) lines.push(`Now ${chen.km} km ${chen.dir} of Chennai.`);
  if (near && pts.length > 1) lines.push(`On IMD's track it comes closest to Chennai, about ${round10(near.km)} km, around ${fmtTime(near.t)}.`);
  box.replaceChildren(
    el("p", { class: "cw-verdict", text: lines.join(" ") }),
    tn.length
      ? el(
          "ul",
          { class: "cw-warn" },
          tn.map((r) => el("li", {}, el("b", { text: `${r.label}${r.region ? ` · ${r.region}` : ""}: ` }), r.text))
        )
      : el("p", { text: "No rain, wind, sea or surge warning for Tamil Nadu or Puducherry in this bulletin." })
  );
  other.replaceChildren(
    rest.length
      ? el("ul", { class: "cw-warn" }, rest.map((r) => el("li", {}, el("b", { text: `${r.label}${r.region ? ` · ${r.region}` : ""}: ` }), r.text)))
      : el("p", { text: "None in this bulletin." })
  );
}

function histRows() {
  const { b, hist } = state;
  return (hist?.bulletins || []).filter((h) => h.system && h.system === b?.system);
}

function renderHistory() {
  const rows = histRows().slice().reverse().slice(0, 12);
  $("cw-hist").replaceChildren(
    ...rows.map((h) => {
      const lf = h.landfall || {};
      const where = lf.between ? `between ${lf.between[0]} and ${lf.between[1]}` : lf.near ? `near ${lf.near}` : null;
      let text = where ? `cross ${lf.coast ? `${lf.coast} coast ` : ""}${where}${lf.when ? `, ${lf.when}` : ""}` : null;
      if (!text) {
        const pts = (h.forecast || []).map(([at, lat, lon]) => ({ t: Date.parse(at), lat, lon }));
        const c = crossing(pts);
        text = c ? `track meets the coast near ${nearestPlace([c.lat, c.lon], km).name}` : "no landfall in the forecast";
      }
      return el(
        "li",
        {},
        el("b", { text: `No. ${h.no} · ${fmtTime(Date.parse(h.issued))}` }),
        el("span", { text: ` ${h.stage || ""}${h.lat ? ` at ${h.lat}°N ${h.lon}°E` : ""}: ${text}` })
      );
    })
  );
}

// "At a glance": one line from each source, filled in as they arrive.
function renderGlance() {
  const { b, models, steer, mjo } = state;
  const items = [];
  const pts = forecastPoints(b);
  const fcCross = crossing(pts);
  const zone = landfallZone(b, fcCross);
  const mid = zoneMid(zone);
  const lf = b.landfall;
  if (lf?.text) {
    const where = lf.between ? `between ${lf.between.join(" and ")}` : lf.near ? `near ${lf.near}` : "";
    items.push(["imd", `IMD: crosses the ${lf.coast || ""} coast ${where}${lf.when ? `, ${lf.when}` : ""}${lf.stage ? ` as a ${lf.stage.toLowerCase()}` : ""}.`]);
  } else if (fcCross) {
    items.push(["imd", `IMD's forecast track meets the coast near ${nearestPlace([fcCross.lat, fcCross.lon], km).name} around ${fmtTime(fcCross.t)}.`]);
  } else {
    items.push(["imd", "IMD's bulletin gives no landfall yet."]);
  }
  const near = closest(pts, CHENNAI);
  if (near && pts.length > 1) items.push(["tn", `Closest to Chennai on IMD's track: about ${round10(near.km)} km, ${fmtTime(near.t)}.`]);
  if (state.twin?.forecast?.length > 1) {
    const tw = crossing(worldPoints(state.twin));
    const off = tw && zone ? zoneKm(zone, [tw.lat, tw.lon]) : null;
    items.push([
      off != null && off <= 100 ? "ok" : "info",
      tw
        ? `JTWC (US Navy) takes it to the coast near ${nearestPlace([tw.lat, tw.lon], km).name}${off != null ? (off <= 25 ? ", inside IMD's zone" : `, ${round10(off)} km from IMD's zone`) : ""}.`
        : "JTWC (US Navy) keeps it at sea through its forecast.",
    ]);
  }
  if (models?.length) {
    const hits = models.filter((m) => m.landfall);
    if (zone && hits.length) {
      const inside = hits.filter((m) => zoneKm(zone, [m.landfall.lat, m.landfall.lon]) <= 25);
      const near = hits.filter((m) => zoneKm(zone, [m.landfall.lat, m.landfall.lon]) <= 100);
      items.push([
        near.length >= hits.length / 2 ? "ok" : "warn",
        `Models: ${inside.length} of ${models.length} cross inside IMD's zone, ${near.length} within 100 km of it${spreadText(models) ? `; ${spreadText(models)}` : ""}.`,
      ]);
    } else if (hits.length) {
      items.push(["info", `Models: ${spreadText(models)}.`]);
    } else {
      items.push(["info", `Models: none of the ${models.length} bring it to the coast within their forecast.`]);
    }
  }
  if (steer?.length && steer[0].speed != null) {
    const s0 = steer[0];
    const ridge = s0.ridge != null ? ` 500 hPa ridge near ${latText(s0.ridge)}, ${s0.ridge > s0.lat ? "north of the storm" : "at or south of the storm"}.` : "";
    items.push(["info", `Steering (GFS) now: towards the ${compass(s0.towards)} at ${Math.round(s0.speed)} km/h.${ridge}`]);
  }
  const m = mjo?.days?.[mjo.days.length - 1];
  if (m) items.push([mjoGood(m, state.twin) ? "ok" : "info", `MJO phase ${m.phase}, amplitude ${m.amp.toFixed(1)}: ${mjoSay(m)}.`]);
  if (mid) {
    const past = PAST.map((p) => ({ ...p, d: km(mid, [p.lat, p.lon]) })).filter((p) => p.d <= 150);
    if (past.length) items.push(["info", `Past storms that crossed within 150 km of this zone: ${past.map((p) => `${p.name} (${p.date.slice(0, 4)})`).join(", ")}.`]);
  }
  $("cw-glance").replaceChildren(...items.map(([k, t]) => el("li", { class: `cw-${k}`, text: t })));
}

function spreadText(models) {
  const hits = models.filter((m) => m.landfall);
  if (hits.length < 2) return hits.length ? `${hits[0].name} near ${hits[0].landfall.place.name}` : "";
  // Order the crossings along the coast by latitude (fine for one coast).
  const s = hits.slice().sort((a, b) => a.landfall.lat - b.landfall.lat);
  const a = s[0].landfall;
  const z = s[s.length - 1].landfall;
  const spread = km([a.lat, a.lon], [z.lat, z.lon]);
  return a.place.name === z.place.name ? `all near ${a.place.name}` : `crossings spread ${round10(spread)} km, ${a.place.name} to ${z.place.name}`;
}

// ---- MJO ----

const MJO_AREA = { 1: "Africa & west Indian Ocean", 2: "Indian Ocean", 3: "Indian Ocean", 4: "Maritime Continent", 5: "Maritime Continent", 6: "West Pacific", 7: "West Pacific", 8: "Western Hemisphere & Africa" };
// The MJO phases that favour storms in each basin (its wet half overhead).
function mjoBasin(w) {
  const b = w?.basin || "";
  if (!w || /north indian/i.test(b)) return { name: "the Bay of Bengal and Arabian Sea", good: [2, 3, 4, 5] };
  if (/south indian/i.test(b)) return { name: "the South Indian Ocean", good: [2, 3, 4] };
  if (/south pacific|australia/i.test(b)) return { name: "the South Pacific", good: [5, 6, 7] };
  if (/west pacific/i.test(b)) return { name: "the West Pacific", good: [5, 6, 7] };
  if (/east pacific|central pacific/i.test(b)) return { name: "the East Pacific", good: [8, 1, 2] };
  if (/atlantic/i.test(b)) return { name: "the Atlantic", good: [8, 1, 2] };
  return { name: "this basin", good: [] };
}
const mjoGood = (m, w) => m.amp >= 1 && mjoBasin(w).good.includes(m.phase);
function mjoSay(m, w) {
  const basin = mjoBasin(w);
  if (m.amp < 1) return `weak, little effect on ${basin.name}`;
  if (basin.good.includes(m.phase)) return `active over the ${MJO_AREA[m.phase]}, a phase when storms in ${basin.name} form and grow more readily`;
  return `active over the ${MJO_AREA[m.phase]}, a phase that usually holds back storms in ${basin.name}`;
}

function renderMjo() {
  const { mjo } = state;
  const sw = state.mode === "world" ? currentWorld() : null;
  const days = mjo?.days || [];
  show("cw-p-mjo", true);
  const svg = $("cw-mjo");
  const text = $("cw-mjo-text");
  if (!days.length) {
    svg.replaceChildren();
    svg.setAttribute("hidden", "");
    text.replaceChildren(el("p", { text: "The MJO index isn't available right now." }));
    return;
  }
  svg.removeAttribute("hidden");
  const S = 32; // px per unit
  const last = days.slice(-40);
  const ns = "http://www.w3.org/2000/svg";
  const mk = (tag, a) => {
    const e = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(a)) e.setAttribute(k, v);
    return e;
  };
  svg.replaceChildren();
  const R = 3.6 * S;
  svg.append(mk("rect", { x: -R, y: -R, width: 2 * R, height: 2 * R, fill: "none", stroke: "#2c4a75" }));
  for (const [x1, y1, x2, y2] of [
    [-R, 0, R, 0],
    [0, -R, 0, R],
    [-R, -R, R, R],
    [-R, R, R, -R],
  ]) {
    svg.append(mk("line", { x1, y1, x2, y2, stroke: "#2c4a75", "stroke-width": 1 }));
  }
  svg.append(mk("circle", { cx: 0, cy: 0, r: S, fill: "#0b1d36", stroke: "#4f7bb5" }));
  // Phase numbers, placed in each octant (RMM1 right, RMM2 up).
  for (let ph = 1; ph <= 8; ph++) {
    const a = ((-180 + (ph - 0.5) * 45) * Math.PI) / 180;
    const t = mk("text", { x: Math.cos(a) * R * 0.82, y: -Math.sin(a) * R * 0.82 + 4, "text-anchor": "middle", "font-size": 12, fill: "#8fb3e6" });
    t.textContent = ph;
    svg.append(t);
  }
  const pts = last.map((d) => [d.rmm1 * S, -d.rmm2 * S]);
  svg.append(mk("polyline", { points: pts.map((p) => p.join(",")).join(" "), fill: "none", stroke: "#ffd54f", "stroke-width": 2, "stroke-linejoin": "round" }));
  const [lx, ly] = pts[pts.length - 1];
  svg.append(mk("circle", { cx: lx, cy: ly, r: 5, fill: "#ff5252", stroke: "#fff", "stroke-width": 1.5 }));
  const m = days[days.length - 1];
  text.replaceChildren(
    el("p", { class: "cw-big" }, "Phase ", el("b", { text: String(m.phase) })),
    el("p", {}, "Amplitude ", el("b", { text: m.amp.toFixed(2) }), m.amp >= 1 ? " (active)" : " (weak)"),
    el("p", { class: `cw-verdict ${mjoGood(m, sw) ? "cw-ok" : ""}`, text: `${mjoSay(m, sw).replace(/^./, (c) => c.toUpperCase())}.` }),
    el("p", { class: "cw-foot", text: `Index for ${fmtDay(m.date)}.` })
  );
}

// ---- Past storms ----

function renderPast() {
  const { b, active } = state;
  let ref = CHENNAI;
  let refName = "Chennai";
  if (active) {
    const zone = landfallZone(b, crossing(forecastPoints(b)));
    const mid = zoneMid(zone);
    if (mid) {
      ref = mid;
      refName = `the middle of IMD's landfall zone (${zone.label})`;
    }
  }
  $("cw-past-ref").textContent = refName;
  $("cw-past-title").textContent = active ? "Past storms near this landfall" : "Past storms near Chennai";
  const list = PAST.map((p) => ({ ...p, d: km(ref, [p.lat, p.lon]) })).sort((a, b) => a.d - b.d).slice(0, 6);
  $("cw-past").replaceChildren(
    ...list.map((p) =>
      el(
        "div",
        { class: "cw-storm" },
        el("strong", { text: p.name }),
        el("span", { class: "cw-year", text: p.date.slice(0, 4) }),
        el("span", { class: "cw-stage", style: `--c:${COLOUR[p.peak]}`, title: LONG[p.peak], text: p.peak }),
        el("small", { text: `Crossed near ${p.near}, ${fmtDay(p.date)}` }),
        el("small", { class: "cw-dist", text: p.d < 15 ? "Right here" : `${round10(p.d)} km away` })
      )
    )
  );
}

// ---- Map ----

async function ensureMap() {
  if (map) return;
  L = await loadLeaflet();
  const box = $("cw-map");
  map = L.map(box, { zoomControl: true, attributionControl: true, minZoom: 4, maxZoom: 10 }).setView([14, 84], 5);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · Tracks: IMD, NHC, JTWC',
  }).addTo(map);
  for (const k of ["zone", "imd", "earlier", "models", "past", "places"]) layers[k] = L.layerGroup();
  for (const k of ["zone", "earlier", "imd", "places"]) layers[k].addTo(map);
  const toggle = (id, k) => {
    const box = $(id);
    const set = () => (box.checked ? layers[k].addTo(map) : layers[k].remove());
    box.addEventListener("change", set);
    set();
  };
  toggle("cw-l-models", "models");
  toggle("cw-l-earlier", "earlier");
  toggle("cw-l-past", "past");
}

// Leaflet moves the marker element with a transform, so the offset goes on
// the inner span.
const label = (L, ll, text, cls) =>
  L.marker(ll, { icon: L.divIcon({ className: `cw-label ${cls || ""}`, html: `<span>${text}</span>`, iconSize: [0, 0] }), interactive: false });

async function drawMap() {
  try {
    await ensureMap();
  } catch (e) {
    $("cw-legend").textContent = `The map didn't load (${e.message}).`;
    return;
  }
  const { b, wfs, wfsLive } = state;
  for (const g of Object.values(layers)) g.clearLayers();
  const bounds = [];
  const pts = forecastPoints(b);
  const fcCross = crossing(pts);

  // Observed track: IMD's map server, or the positions of this system's bulletins.
  let observed = [];
  if (wfsLive) {
    for (const f of wfs.features) {
      if (!f.geometry || !/observed/i.test(f.properties?.cyclone_type || "")) continue;
      const lines = f.geometry.type === "MultiLineString" ? f.geometry.coordinates : f.geometry.type === "LineString" ? [f.geometry.coordinates] : [];
      for (const line of lines) observed.push(...line.map(([x, y]) => (x > 50 ? [y, x] : [x, y])));
    }
  }
  if (!observed.length) observed = histRows().filter((h) => h.lat).map((h) => [h.lat, h.lon]);
  if (observed.length > 1) {
    L.polyline(observed, { color: "#ff5252", weight: 4 }).bindTooltip("Observed track (IMD)").addTo(layers.imd);
    for (const p of observed) L.circleMarker(p, { radius: 3, color: "#ff5252", fillColor: "#fff", fillOpacity: 1, weight: 2 }).addTo(layers.imd);
    bounds.push(...observed);
  }

  // IMD forecast track, coloured by stage.
  if (pts.length) {
    const ll = pts.map((p) => [p.lat, p.lon]);
    L.polyline(ll, { color: "#ffffff", weight: 2.5, dashArray: "8 6", opacity: 0.9 }).bindTooltip("IMD forecast track").addTo(layers.imd);
    pts.forEach((p, i) => {
      L.circleMarker([p.lat, p.lon], { radius: i ? 6 : 9, color: "#0b1d36", weight: 2, fillColor: stageColour(p.stage), fillOpacity: 1 })
        .bindTooltip(`${fmtTime(p.t)}<br>${p.stage || ""}${p.wind ? `, ${p.wind.min}–${p.wind.max} km/h` : ""}`)
        .addTo(layers.imd);
    });
    // Label every 24 hours.
    let lastLabel = -Infinity;
    for (const p of pts) {
      if (p.t - lastLabel < 23 * 3600000) continue;
      lastLabel = p.t;
      label(L, [p.lat, p.lon], new Date(p.t).toLocaleDateString("en-IN", { ...IST, day: "numeric", month: "short" }), "cw-l-date").addTo(layers.imd);
    }
    bounds.push(...ll);
    const name = (b.name || "").toUpperCase();
    label(L, [pts[0].lat, pts[0].lon], `<span class="cw-eye">🌀</span>${name}`, "cw-l-storm").addTo(layers.imd);
  }

  // IMD's landfall zone.
  const zone = landfallZone(b, fcCross);
  if (zone?.shore?.length > 1) {
    L.polyline(zone.shore, { color: "#ff9800", weight: 14, opacity: 0.55, lineCap: "round" }).addTo(layers.zone);
    L.polyline(zone.shore, { color: "#ffd54f", weight: 3, opacity: 1 }).addTo(layers.zone);
    const mid = zoneMid(zone);
    label(L, mid, `IMD landfall zone<br><b>${zone.label}</b>`, "cw-l-zone").addTo(layers.zone);
    bounds.push(...zone.shore);
  }

  // Earlier IMD forecasts for this system (the 4 before this one).
  const earlier = histRows().filter((h) => h.no !== b.no).slice(-4);
  for (const h of earlier) {
    const ll = (h.forecast || []).map(([, lat, lon]) => [lat, lon]);
    if (ll.length > 1) L.polyline(ll, { color: "#b0bec5", weight: 2, opacity: 0.7, dashArray: "2 6" }).bindTooltip(`IMD bulletin No. ${h.no}`).addTo(layers.earlier);
  }

  // JTWC's forecast for the same storm, a second opinion.
  const twin = state.twin;
  if (twin?.forecast?.length > 1) {
    L.polyline(
      worldPoints(twin).map((p) => [p.lat, p.lon]),
      { color: "#4dd0e1", weight: 2.5, dashArray: "4 6", opacity: 0.95 }
    )
      .bindTooltip("JTWC forecast")
      .addTo(layers.imd);
  }

  // Places.
  L.circleMarker(CHENNAI, { radius: 6, color: "#fff", weight: 2, fillColor: "#e91e63", fillOpacity: 1 }).addTo(layers.places);
  label(L, CHENNAI, "Chennai", "cw-l-place").addTo(layers.places);
  bounds.push(CHENNAI);

  // Past storms.
  for (const p of PAST) {
    L.circleMarker([p.lat, p.lon], { radius: 4, color: "#cfd8dc", weight: 1, fillColor: "#78909c", fillOpacity: 1 })
      .bindTooltip(`${p.name} (${p.date.slice(0, 4)}), ${p.peak}`)
      .addTo(layers.past);
  }

  drawModels();
  if (bounds.length) map.fitBounds(L.latLngBounds(bounds).pad(0.12), { maxZoom: 7 });
  setTimeout(() => map.invalidateSize(), 0);
  legend();
}

function drawModels() {
  if (!map || !layers.models) return;
  layers.models.clearLayers();
  for (const m of state.models || []) {
    if (m.track.length < 2) continue;
    L.polyline(
      m.track.map((p) => [p.lat, p.lon]),
      { color: m.colour, weight: 2.5, opacity: 0.95 }
    )
      .bindTooltip(m.name)
      .addTo(layers.models);
    if (m.landfall) L.circleMarker([m.landfall.lat, m.landfall.lon], { radius: 5, color: "#fff", weight: 1.5, fillColor: m.colour, fillOpacity: 1 }).addTo(layers.models);
  }
  legend();
}

function legend() {
  const w = state.mode === "world" ? currentWorld() : null;
  const parts = w
    ? [`<span class="cw-key" style="--c:#ff5252"></span>Past positions`, `<span class="cw-key cw-dash" style="--c:#fff"></span>${SHORT_AGENCY[w.source] || w.agency} forecast`]
    : [
        `<span class="cw-key" style="--c:#ff5252"></span>Observed`,
        `<span class="cw-key cw-dash" style="--c:#fff"></span>IMD forecast`,
        `<span class="cw-key cw-thick" style="--c:#ff9800"></span>IMD landfall zone`,
      ];
  if (!w && state.twin?.forecast?.length) parts.push(`<span class="cw-key cw-dash" style="--c:#4dd0e1"></span>JTWC forecast`);
  for (const m of state.models || []) if (m.track.length > 1) parts.push(`<span class="cw-key" style="--c:${m.colour}"></span>${m.name}`);
  $("cw-legend").innerHTML = parts.map((p) => `<span>${p}</span>`).join("");
}

// ---- Models and steering ----

async function loadModels() {
  const { b } = state;
  const world = state.mode === "world" ? currentWorld() : null;
  const pts = world ? worldPoints(world) : forecastPoints(b);
  const start = world
    ? world.lat != null && { lat: world.lat, lon: world.lon, t: Date.parse(world.at) || Date.now() }
    : b.at
      ? { lat: b.lat, lon: b.lon, t: Date.parse(b.at) }
      : pts[0];
  if (!start?.lat && start?.lat !== 0) {
    $("cw-models-status").textContent = "The storm's position isn't known, so the models can't be followed.";
    return;
  }
  const key = world ? `${world.id}-${world.at}` : `${b.system}-${b.no}`;
  const sel = state.sel;
  let cache = null;
  try {
    cache = JSON.parse(localStorage.getItem(MODEL_CACHE));
  } catch {}
  if (cache?.key === key && Date.now() - cache.at < MODEL_TTL) {
    Object.assign(state, { models: cache.models, steer: cache.steer, land: cache.land });
    afterModels(cache.at);
    return;
  }
  $("cw-models-status").textContent = `Reading ${MODELS.length} models…`;
  $("cw-steer-status").textContent = "Reading GFS winds…";
  // Steering at IMD's position now and every 24 hours along its track, up to
  // the coast.
  const cross = world ? null : crossing(pts);
  const end = cross ? cross.t : Math.min(pts[pts.length - 1]?.t ?? 0, start.t + 4 * 86400000);
  const along = [];
  for (let t = start.t; end && t <= end; t += 24 * 3600000) {
    const p = t === start.t ? start : positionAt(pts, t);
    if (p) along.push({ t: Math.round(t / 1000), lat: p.lat, lon: p.lon });
  }
  const [mr, sr] = await Promise.allSettled([
    modelTracks({ lat: start.lat, lon: start.lon, t: Math.round(start.t / 1000) }, { india: !world || isIndian(world) }),
    steering(along),
  ]);
  // Another storm picked while these were loading.
  if (state.sel !== sel) return;
  const models = mr.status === "fulfilled" ? mr.value.models.map(slim) : null;
  const land = mr.status === "fulfilled" ? mr.value.land : null;
  const steer = sr.status === "fulfilled" ? sr.value : null;
  state.models = models;
  state.steer = steer;
  state.land = land;
  if (models && steer) {
    try {
      localStorage.setItem(MODEL_CACHE, JSON.stringify({ key, at: Date.now(), models, steer, land }));
    } catch {}
  }
  afterModels(Date.now(), mr.reason, sr.reason);
}

// Keeps what the screen needs (unix seconds → ms).
function slim(m) {
  return {
    name: m.name,
    colour: m.colour,
    track: m.track.map((p) => ({ t: p.t * 1000, lat: +p.lat.toFixed(2), lon: +p.lon.toFixed(2), hPa: Math.round(p.hPa) })),
    landfall: m.landfall
      ? { t: m.landfall.t * 1000, lat: m.landfall.lat, lon: m.landfall.lon, place: m.landfall.place ? { name: m.landfall.place.name, state: m.landfall.place.state } : null }
      : null,
    lowest: m.lowest != null ? Math.round(m.lowest) : null,
    lost: !!m.lost,
  };
}

function afterModels(at, modelErr, steerErr) {
  if (state.mode === "world") return afterWorldModels(at, modelErr, steerErr);
  const { models, steer, b } = state;
  const stamp = new Date(at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  // Models table.
  if (!models) {
    $("cw-models-status").textContent = `Couldn't read the models (${modelErr?.message || "no answer"}).`;
  } else {
    $("cw-models-status").textContent = `Model runs read at ${stamp}.`;
    const pts = forecastPoints(b);
    const fcCross = crossing(pts);
    const zone = landfallZone(b, fcCross);
    const head = el("tr", {}, ...["Model", "Crosses near", "When (IST)", "Lowest"].map((h) => el("th", { text: h })));
    const imdWhere = b.landfall?.between ? `${b.landfall.between.join(" – ")}` : zone?.label || "—";
    const rows = [
      el(
        "tr",
        { class: "cw-imdrow" },
        el("td", {}, el("span", { class: "cw-key", style: "--c:#fff" }), "IMD (official)"),
        el("td", { text: imdWhere }),
        el("td", { text: landfallTime(b) ? `≈ ${fmtShort(landfallTime(b))}` : b.landfall?.when || (fcCross ? fmtShort(fcCross.t) : "—") }),
        el("td", { text: "" })
      ),
    ];
    // JTWC's track for the same storm, where it meets the coast.
    const tw = state.twin ? crossing(worldPoints(state.twin)) : null;
    if (state.twin) {
      const off = tw ? zoneKm(zone, [tw.lat, tw.lon]) : null;
      rows.push(
        el(
          "tr",
          {},
          el("td", {}, el("span", { class: "cw-key", style: "--c:#4dd0e1" }), "JTWC (US Navy)"),
          el(
            "td",
            {},
            tw ? nearestPlace([tw.lat, tw.lon], km).name : "Stays at sea in its forecast",
            off != null ? el("small", { class: `cw-off ${off <= 25 ? "cw-in" : ""}`, text: off <= 25 ? "inside IMD's zone" : `${round10(off)} km outside IMD's zone` }) : null
          ),
          el("td", { text: tw ? fmtShort(tw.t) : "" }),
          el("td", { class: "num", text: state.twin.hPa ? `${state.twin.hPa} hPa now` : "" })
        )
      );
    }
    for (const m of models) {
      let where;
      let whenText = "";
      if (m.landfall) {
        const off = zoneKm(zone, [m.landfall.lat, m.landfall.lon]);
        const offText = off == null ? null : off <= 25 ? "inside IMD's zone" : `${round10(off)} km outside IMD's zone`;
        where = [m.landfall.place.name, offText ? el("small", { class: `cw-off ${off <= 25 ? "cw-in" : ""}`, text: offText }) : null];
        whenText = fmtShort(m.landfall.t);
      } else if (m.lost || m.track.length < 2) {
        where = "Low not found near IMD's position";
      } else {
        const last = m.track[m.track.length - 1];
        where = `At sea: fades near ${last.lat.toFixed(1)}°N ${last.lon.toFixed(1)}°E`;
        whenText = fmtShort(last.t);
      }
      rows.push(
        el(
          "tr",
          {},
          el("td", {}, el("span", { class: "cw-key", style: `--c:${m.colour}` }), m.name),
          el("td", {}, where),
          el("td", { text: whenText }),
          el("td", { class: "num", text: m.lowest ? `${m.lowest} hPa` : "" })
        )
      );
    }
    $("cw-models").replaceChildren(el("thead", {}, head), el("tbody", {}, rows));
    const spread = spreadText(models);
    $("cw-spread").textContent = spread ? `${spread.replace(/^./, (c) => c.toUpperCase())}.` : "";
  }
  // Steering table.
  if (!steer) {
    $("cw-steer-status").textContent = `Couldn't read the GFS winds (${steerErr?.message || "no answer"}).`;
  } else {
    $("cw-steer-status").textContent = "";
    const head = el("tr", {}, ...["When (IST)", "Storm °N, °E", "Steering", "Ridge"].map((h) => el("th", { text: h })));
    const rows = steer.map((s) =>
      el(
        "tr",
        {},
        el("td", { text: fmtShort(s.t * 1000) }),
        el("td", { text: `${s.lat.toFixed(1)}, ${s.lon.toFixed(1)}` }),
        el("td", { text: s.speed != null ? `→ ${abbr(compass(s.towards))} ${Math.round(s.speed)} km/h` : "—" }),
        el("td", { text: s.ridge != null ? latText(s.ridge) : "—" })
      )
    );
    $("cw-steer").replaceChildren(el("thead", {}, head), el("tbody", {}, rows));
    $("cw-steer-say").textContent = steerSay(steer);
  }
  renderGlance();
  drawModels();
}

// "west-northwest" → "WNW".
const abbr = (dir) => dir.split("-").map((w) => w.replace(/north/g, "N").replace(/south/g, "S").replace(/east/g, "E").replace(/west/g, "W")).join("");

function steerSay(steer) {
  const s = steer.filter((x) => x.speed != null);
  if (!s.length) return "";
  const out = [];
  const first = s[0];
  out.push(`The deep-layer flow now pushes towards the ${compass(first.towards)} at ${Math.round(first.speed)} km/h${first.speed < 10 ? ", weak, so the storm drifts slowly" : ""}.`);
  const r = s.filter((x) => x.ridge != null);
  if (r.length >= 2) {
    const south = r[0].lat < 0;
    const pole = south ? "south" : "north";
    const d = Math.abs(r[r.length - 1].ridge) - Math.abs(r[0].ridge);
    const move = Math.abs(d) < 1 ? "stays near" : d > 0 ? `moves ${pole} to` : `moves ${south ? "north" : "south"} (towards the equator) to`;
    const last = r[r.length - 1];
    out.push(`The ridge ${move} ${latText(last.ridge)} by ${fmtTime(last.t * 1000)}.`);
    if (Math.abs(last.ridge) - Math.abs(last.lat) < 2) out.push(`By then the storm is close to the ridge's latitude, where storms often turn ${pole}.`);
    else out.push(`The ridge stays ${pole} of the storm, which favours a westward track, curving ${pole}west.`);
  }
  return out.join(" ");
}

// ---- Storms around the world ----

const isIndian = (w) => /north indian/i.test(w?.basin || "") || (w?.lat > 0 && w?.lat < 30 && w?.lon > 45 && w?.lon < 100);
const SHORT_AGENCY = { nhc: "NHC", jtwc: "JTWC", gdacs: "GDACS" };
const latText = (v) => `${Math.abs(v).toFixed(1)}°${v >= 0 ? "N" : "S"}`;
const lonText = (v) => `${Math.abs(((((v + 180) % 360) + 360) % 360) - 180).toFixed(1)}°${((((v + 180) % 360) + 360) % 360) - 180 >= 0 ? "E" : "W"}`;
const kmhOf = (kt) => (kt == null ? null : Math.round(kt * 1.852));

// Saffir–Simpson colours by 1-minute wind (knots).
function ktColour(kt) {
  if (kt == null) return "#9e9e9e";
  if (kt >= 137) return "#6a1b9a";
  if (kt >= 113) return "#b71c1c";
  if (kt >= 96) return "#f44336";
  if (kt >= 83) return "#ff5722";
  if (kt >= 64) return "#ff9800";
  if (kt >= 34) return "#ffc107";
  return "#4caf50";
}
function ktClass(kt) {
  if (kt == null) return "";
  if (kt >= 137) return "Cat 5";
  if (kt >= 113) return "Cat 4";
  if (kt >= 96) return "Cat 3";
  if (kt >= 83) return "Cat 2";
  if (kt >= 64) return "Cat 1";
  if (kt >= 34) return "TS";
  return "TD";
}

// The IMD storm (when active) and every other storm, IMD first. JTWC also
// warns on Bay of Bengal storms; that copy is kept as the IMD storm's "twin"
// rather than listed twice.
function stormList() {
  const out = [];
  const { b } = state;
  const world = (state.world?.storms || []).filter((w) => w.lat != null);
  state.twin = null;
  if (state.active) {
    out.push({ id: "imd", kind: "imd", name: b.name || b.stage || "IMD system", sub: `${SHORT[b.stage] || b.stage || ""} · IMD`, lat: b.lat, lon: b.lon, colour: stageColour(b.stage) });
    const twin = world.find((w) => b.lat != null && km([b.lat, b.lon], [w.lat, w.lon]) < 500);
    if (twin) state.twin = twin;
  }
  for (const w of world) {
    if (w === state.twin) continue;
    out.push({ id: w.id, kind: "world", s: w, name: w.name || w.number || "Storm", sub: `${w.basin || ""} · ${w.kt != null ? `${kmhOf(w.kt)} km/h` : SHORT_AGENCY[w.source] || ""}`, lat: w.lat, lon: w.lon, colour: ktColour(w.kt) });
  }
  return out;
}

// The last storm picked if it is still active, else the Indian region's
// (IMD's, then any North or South Indian Ocean storm), else the strongest.
function pickDefault(prev) {
  const list = stormList();
  if (!list.length) return null;
  let saved = prev;
  if (!saved) {
    try {
      saved = localStorage.getItem(PICK_KEY);
    } catch {}
  }
  if (saved && list.some((x) => x.id === saved)) return saved;
  const indian = list.find((x) => x.kind === "imd") || list.find((x) => isIndian(x.s)) || list.find((x) => /indian/i.test(x.s?.basin || ""));
  if (indian) return indian.id;
  return list.slice().sort((a, b) => (b.s?.kt ?? 0) - (a.s?.kt ?? 0))[0].id;
}

const currentWorld = () => (state.world?.storms || []).find((w) => w.id === state.sel) || null;

function pick(id) {
  if (id === state.sel) return;
  state.sel = id;
  try {
    localStorage.setItem(PICK_KEY, id);
  } catch {}
  render();
  if (state.mode !== "calm") loadModels();
  $("cw-head").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderPicker(list) {
  // Shown whenever there is more than one storm, or one that isn't IMD's.
  const on = list.length > 1 || (list.length === 1 && list[0].kind === "world");
  show("cw-p-world", on);
  if (!on) return;
  $("cw-pick").replaceChildren(
    ...list.map((x) =>
      el(
        "button",
        { type: "button", class: `cw-pickbtn ${x.id === state.sel ? "cw-on" : ""}`, "aria-pressed": String(x.id === state.sel), style: `--c:${x.colour}` },
        el("b", { text: `🌀 ${x.name}` }),
        el("small", { text: x.sub })
      )
    )
  );
  [...$("cw-pick").children].forEach((btn, i) => btn.addEventListener("click", () => pick(list[i].id)));
  drawWorldMap(list);
}

async function drawWorldMap(list) {
  try {
    L = L || (await loadLeaflet());
  } catch {
    return;
  }
  if (!worldMap) {
    worldMap = L.map($("cw-worldmap"), { zoomControl: false, attributionControl: true, minZoom: 1, maxZoom: 5, worldCopyJump: true }).setView([10, 80], 1);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(worldMap);
    worldLayer = L.layerGroup().addTo(worldMap);
  }
  worldLayer.clearLayers();
  const ref = list.find((x) => x.lat != null)?.lon ?? 80;
  for (const x of unwrap(list.filter((s) => s.lat != null), ref)) {
    const on = x.id === state.sel;
    L.circleMarker([x.lat, x.lon], { radius: on ? 9 : 7, color: on ? "#fff" : "#0b1d36", weight: 2, fillColor: x.colour, fillOpacity: 1 })
      .on("click", () => pick(x.id))
      .addTo(worldLayer);
    label(L, [x.lat, x.lon], x.name.toUpperCase(), `cw-l-world ${on ? "cw-l-on" : ""}`).addTo(worldLayer);
  }
  // Centre on the storms, keeping the whole band of the tropics in view.
  // Longitudes are taken the short way round from the first storm, so storms
  // either side of the dateline sit together.
  const lons = unwrap(list.filter((x) => x.lat != null), ref).map((x) => x.lon);
  const mid = lons.length ? (Math.min(...lons) + Math.max(...lons)) / 2 : 80;
  worldMap.setView([5, mid], 1);
  setTimeout(() => worldMap.invalidateSize(), 0);
}

// Agency points as { t, lat, lon, kt, note }, longitudes kept continuous.
function worldPoints(w) {
  const pts = (w.forecast || []).map((p) => ({ ...p, t: Date.parse(p.at) })).filter((p) => Number.isFinite(p.t));
  return unwrap(pts, w.lon);
}
function unwrap(pts, ref) {
  return pts.map((p) => {
    let lon = p.lon;
    while (lon - ref > 180) lon -= 360;
    while (lon - ref < -180) lon += 360;
    return { ...p, lon };
  });
}

// Puts the IMD-only panels back the way the IMD storm needs them.
const GLANCE_FOOT = "IMD's bulletin is the official forecast. The other lines are what the models and indices show, read by the app; they are not a forecast of their own.";

function resetImdPanels() {
  $("cw-lb-earlier").hidden = false;
  $("cw-lb-past").hidden = false;
  $("cw-glance-foot").textContent = GLANCE_FOOT;
  $("cw-p-fc").querySelector("h3").textContent = FC_TITLE;
  if (fcFoot) $("cw-p-fc").querySelector(".cw-foot").textContent = fcFoot;
  $("cw-tn-title").textContent = "Tamil Nadu & Chennai";
  $("cw-more").hidden = false;
  $("cw-img-title").textContent = "IMD's track & cone";
  $("cw-img-cap").textContent = "The cone shows where the centre may go. Courtesy: India Meteorological Department.";
  const box = $("cw-p-img");
  box.dataset.shareImd = "";
  delete box.dataset.shareCredit;
  box.dataset.share = "IMD cyclone track and cone";
}

function renderWorld(w) {
  const indian = isIndian(w);
  $("cw-lb-earlier").hidden = true;
  $("cw-lb-past").hidden = !indian;
  $("cw-glance-foot").textContent = GLANCE_FOOT.replace(
    "IMD's bulletin is the official forecast.",
    w.source === "nhc"
      ? "NHC's advisory is the official forecast."
      : `${SHORT_AGENCY[w.source] || w.agency}'s warning is the forecast shown here; the official one for each sea comes from its regional centre (such as Japan, Australia, Fiji or Réunion).`
  );
  show("cw-mapbox", true);
  show("cw-p-glance", true);
  show("cw-p-fc", (w.forecast || []).length > 0);
  show("cw-p-tn", true);
  show("cw-p-models", w.lat != null);
  show("cw-p-steer", w.lat != null);
  show("cw-p-hist", false);
  show("cw-p-past", indian);
  show("cw-p-img", !!w.picture);
  renderWorldHead(w);
  renderWorldForecast(w);
  renderWorldWarnings(w);
  renderWorldGlance(w);
  // The agency's own picture, with its credit.
  const box = $("cw-p-img");
  delete box.dataset.shareImd;
  box.dataset.shareCredit = w.credit || `Courtesy: ${w.agency}`;
  box.dataset.share = `${SHORT_AGENCY[w.source] || w.agency} forecast graphic`;
  $("cw-img-title").textContent = `${SHORT_AGENCY[w.source] || w.agency}'s forecast graphic`;
  $("cw-img-cap").textContent = `${w.source === "nhc" ? "The cone shows where the centre may go. " : ""}${w.credit || `Courtesy: ${w.agency}`}.`;
  if (w.picture) $("cw-img").src = `${DATA}${w.picture}?t=${encodeURIComponent(w.at || "")}`;
  drawWorldStormMap(w);
  renderMjo();
  if (indian) renderPast();
}

function stormTitle(w) {
  const cat = w.category && w.source !== "nhc" ? ` (${w.category.replace("Category", "Cat")} strength)` : w.category ? ` (${w.category})` : "";
  return `${w.type || "Tropical cyclone"}${cat}`;
}

function renderWorldHead(w) {
  $("cw-head").classList.remove("cw-calm");
  const kind = w.source === "nhc" ? "Advisory" : w.source === "jtwc" ? "Warning" : "Report";
  $("cw-kicker").textContent = `${w.agency}${w.advisory ? ` · ${kind} ${w.advisory}` : ""}${w.number ? ` (${w.number})` : ""} · ${w.at ? fmtTime(Date.parse(w.at)) : ""}`;
  $("cw-stage").textContent = stormTitle(w);
  $("cw-name").textContent = (w.name || "").toUpperCase();
  const g = w.gdacs || {};
  const alert = $("cw-alert");
  alert.hidden = !g.alert;
  alert.textContent = g.alert ? `GDACS ${g.alert} alert${g.countries?.length ? ` · ${g.countries.join(", ")}` : ""}` : "";
  alert.className = `cw-alert ${g.alert ? `cw-${g.alert.toLowerCase()}` : ""}`;
  const lf = $("cw-landfall");
  const words = w.headline || w.hazards || w.outlook;
  lf.hidden = !words;
  lf.replaceChildren(el("b", { text: `${SHORT_AGENCY[w.source] || w.agency}: ` }), sentenceCase(words || ""));
  const chips = $("cw-chips");
  chips.replaceChildren();
  if (w.kt != null) chips.append(chip("Wind now (1-min)", `${kmhOf(w.kt)} km/h · ${w.kt} kt`));
  if (w.hPa) chips.append(chip("Pressure", `${w.hPa} hPa`));
  if (w.movement) chips.append(chip("Motion", w.movement.replace(/towards (\d+)°/, (m, d) => `towards ${compass(+d)}`)));
  if (w.basin) chips.append(chip("Basin", w.basin));
  if (w.lat != null) chips.append(chip("Position at", `${w.at ? fmtTime(Date.parse(w.at)) : ""}: ${latText(w.lat)} ${lonText(w.lon)}`));
  if (isIndian(w)) chips.append(chip("From Chennai", `${round10(km(CHENNAI, [w.lat, w.lon]))} km ${dir8(CHENNAI, [w.lat, w.lon])}`));
}

// JTWC and NHC write in capitals; this reads easier. Short all-capital words
// (NM, KT, MB, place codes in brackets) are left alone.
function sentenceCase(t) {
  if (!/[a-z]/.test(t) && /[A-Z]{4}/.test(t)) {
    t = t.toLowerCase().replace(/(^|[.!?]\s+)([a-z])/g, (m, a, c) => a + c.toUpperCase());
    t = t.replace(/\b(nm|kt|kts|mb|utc)\b/g, (m) => m.toUpperCase()).replace(/\(([a-z])/g, (m, c) => `(${c.toUpperCase()}`);
    t = t.replace(/\b(\d{2}[a-z])\b/g, (m) => m.toUpperCase());
  }
  return t;
}

function renderWorldForecast(w) {
  const pts = worldPoints(w);
  const indian = isIndian(w);
  const head = el("tr", {}, ...["When (IST)", "Lat, lon", "Wind km/h (kt)", "Class", indian ? "Chennai" : "Note"].map((h) => el("th", { text: h })));
  const rows = pts.map((p) =>
    el(
      "tr",
      {},
      el("td", { text: fmtShort(p.t) }),
      el("td", { text: `${latText(p.lat)}, ${lonText(p.lon)}` }),
      el("td", { class: "num", text: p.kt != null ? `${kmhOf(p.kt)} (${p.kt})` : "" }),
      el("td", {}, el("span", { class: "cw-stage", style: `--c:${ktColour(p.kt)}`, text: ktClass(p.kt) })),
      el("td", { class: indian ? "num" : "", text: indian ? `${round10(km(CHENNAI, [p.lat, p.lon]))} km` : p.now ? "Now" : p.note || "" })
    )
  );
  $("cw-fc").replaceChildren(el("thead", {}, head), el("tbody", {}, rows));
  const fc = $("cw-p-fc");
  fc.querySelector("h3").textContent = `${SHORT_AGENCY[w.source] || w.agency} forecast track`;
  fc.querySelector(".cw-foot").textContent =
    `From the ${w.agency}'s ${w.source === "nhc" ? "forecast advisory" : "warning"}. Wind is the 1-minute sustained wind; the class is the Saffir–Simpson scale for that wind (TS: tropical storm, TD: depression), as a guide outside the Atlantic and East Pacific.`;
}

function renderWorldWarnings(w) {
  $("cw-tn-title").textContent = "Warnings & outlook";
  $("cw-more").hidden = true;
  const g = w.gdacs || {};
  const items = [];
  if (w.warnings) items.push(["Watches and warnings", w.warnings]);
  if (w.hazards) items.push(["Hazards affecting land", w.hazards]);
  if (w.outlook) items.push([w.source === "jtwc" ? "JTWC remarks" : "Discussion and outlook", w.outlook]);
  if (g.severity || g.countries?.length) items.push(["GDACS", `${g.alert ? `${g.alert} alert. ` : ""}${g.severity || ""}${g.countries?.length ? `. Countries it may affect: ${g.countries.join(", ")}.` : ""}`]);
  const links = [];
  if (w.links?.advisory) links.push(el("a", { href: w.links.advisory, target: "_blank", rel: "noopener noreferrer", text: `${SHORT_AGENCY[w.source] || w.agency} ${w.source === "nhc" ? "advisory" : "warning"}` }));
  if (w.links?.graphics) links.push(el("a", { href: w.links.graphics, target: "_blank", rel: "noopener noreferrer", text: "NHC graphics" }));
  if (g.report) links.push(el("a", { href: g.report, target: "_blank", rel: "noopener noreferrer", text: "GDACS report" }));
  $("cw-tn").replaceChildren(
    items.length ? el("ul", { class: "cw-warn" }, items.map(([k, t]) => el("li", {}, el("b", { text: `${k}: ` }), sentenceCase(t)))) : el("p", { text: "The agency's text has no warnings for land." }),
    links.length ? el("p", { class: "cw-links" }, ...links.flatMap((a, i) => (i ? [" · ", a] : [a]))) : null
  );
}

function renderWorldGlance(w) {
  const { models, steer, mjo, land } = state;
  const items = [];
  const pts = worldPoints(w);
  const agency = SHORT_AGENCY[w.source] || w.agency;
  if (w.headline) items.push(["imd", `${agency}: ${sentenceCase(w.headline)}.`]);
  const peak = pts.reduce((a, p) => (p.kt != null && (!a || p.kt > a.kt) ? p : a), null);
  if (peak && pts.length > 1) items.push(["imd", `${agency} forecast: strongest around ${fmtShort(peak.t)}, ${kmhOf(peak.kt)} km/h (${peak.kt} kt, ${ktClass(peak.kt)}).`]);
  const isLand = landTest(land);
  if (isLand && pts.length > 1) {
    const hit = pts.find((p, i) => i > 0 && isLand(p.lat, p.lon) && isLand(pts[i - 1].lat, pts[i - 1].lon) === false);
    items.push(["tn", hit ? `${agency}'s track is over land by about ${fmtShort(hit.t)} (near ${latText(hit.lat)}, ${lonText(hit.lon)}).` : `${agency}'s track stays over the sea for the whole forecast.`]);
  }
  if (w.gdacs?.alert) items.push([w.gdacs.alert === "Green" ? "info" : "warn", `GDACS ${w.gdacs.alert.toLowerCase()} alert${w.gdacs.countries?.length ? ` for ${w.gdacs.countries.join(", ")}` : ""}.`]);
  if (models?.length && pts.length > 1) {
    const sp = modelSpread(models, pts);
    if (sp) items.push([sp.max <= 300 ? "ok" : "warn", sp.text]);
  }
  if (steer?.length && steer[0].speed != null) {
    const s0 = steer[0];
    items.push(["info", `Steering (GFS) now: towards the ${compass(s0.towards)} at ${Math.round(s0.speed)} km/h.${s0.ridge != null ? ` 500 hPa ridge near ${latText(s0.ridge)}.` : ""}`]);
  }
  const m = mjo?.days?.[mjo.days.length - 1];
  if (m) items.push([mjoGood(m, w) ? "ok" : "info", `MJO phase ${m.phase}, amplitude ${m.amp.toFixed(1)}: ${mjoSay(m, w)}.`]);
  $("cw-glance").replaceChildren(...items.map(([k, t]) => el("li", { class: `cw-${k}`, text: t })));
}

// How far each model is from the agency's position at the agency's last
// forecast time within 3 days.
function modelSpread(models, pts) {
  const t0 = pts[0].t;
  const target = pts.filter((p) => p.t - t0 <= 72 * 3600000).pop();
  if (!target || target === pts[0]) return null;
  const d = [];
  for (const m of models) {
    const at = positionAt(m.track, target.t);
    if (at) d.push(km([at.lat, at.lon], [target.lat, target.lon]));
  }
  if (!d.length) return null;
  const hours = Math.round((target.t - t0) / 3600000);
  return {
    max: Math.max(...d),
    text: `Models at ${hours} h: ${d.length} of ${models.length} still have the storm, ${round10(Math.min(...d))}–${round10(Math.max(...d))} km from the agency's position.`,
  };
}

async function drawWorldStormMap(w) {
  try {
    await ensureMap();
  } catch (e) {
    $("cw-legend").textContent = `The map didn't load (${e.message}).`;
    return;
  }
  for (const g of Object.values(layers)) g.clearLayers();
  const bounds = [];
  const past = unwrap((w.past || []).map((p) => ({ ...p })), w.lon).map((p) => [p.lat, p.lon]);
  if (past.length > 1) {
    L.polyline(past, { color: "#ff5252", weight: 4 }).bindTooltip("Past positions").addTo(layers.imd);
    bounds.push(...past);
  }
  const pts = worldPoints(w);
  if (pts.length) {
    const ll = pts.map((p) => [p.lat, p.lon]);
    L.polyline(ll, { color: "#ffffff", weight: 2.5, dashArray: "8 6", opacity: 0.9 }).addTo(layers.imd);
    pts.forEach((p, i) =>
      L.circleMarker([p.lat, p.lon], { radius: i ? 6 : 9, color: "#0b1d36", weight: 2, fillColor: ktColour(p.kt), fillOpacity: 1 })
        .bindTooltip(`${fmtTime(p.t)}<br>${p.kt != null ? `${kmhOf(p.kt)} km/h (${p.kt} kt)` : ""}`)
        .addTo(layers.imd)
    );
    let lastLabel = -Infinity;
    for (const p of pts) {
      if (p.t - lastLabel < 23 * 3600000) continue;
      lastLabel = p.t;
      label(L, [p.lat, p.lon], new Date(p.t).toLocaleDateString("en-IN", { ...IST, day: "numeric", month: "short" }), "cw-l-date").addTo(layers.imd);
    }
    bounds.push(...ll);
  }
  if (w.lat != null) {
    label(L, [w.lat, w.lon], `<span class="cw-eye">🌀</span>${(w.name || "").toUpperCase()}`, "cw-l-storm").addTo(layers.imd);
    bounds.push([w.lat, w.lon]);
  }
  if (isIndian(w)) {
    L.circleMarker(CHENNAI, { radius: 6, color: "#fff", weight: 2, fillColor: "#e91e63", fillOpacity: 1 }).addTo(layers.places);
    label(L, CHENNAI, "Chennai", "cw-l-place").addTo(layers.places);
  }
  drawModels();
  if (bounds.length) map.fitBounds(L.latLngBounds(bounds).pad(0.35), { maxZoom: 6 });
  setTimeout(() => map.invalidateSize(), 0);
  legend();
}

function afterWorldModels(at, modelErr, steerErr) {
  const w = currentWorld();
  if (!w) return;
  const { models, steer } = state;
  const agency = SHORT_AGENCY[w.source] || w.agency;
  const stamp = new Date(at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  const isLand = landTest(state.land);
  if (!models) {
    $("cw-models-status").textContent = `Couldn't read the models (${modelErr?.message || "no answer"}).`;
  } else {
    $("cw-models-status").textContent = `Model runs read at ${stamp}.`;
    const pts = worldPoints(w);
    const head = el("tr", {}, ...["Model", "Reaches land", "When (IST)", "Lowest"].map((h) => el("th", { text: h })));
    const landAt = (track) => {
      if (!isLand) return null;
      for (let i = 1; i < track.length; i++) if (isLand(track[i].lat, track[i].lon) && isLand(track[i - 1].lat, track[i - 1].lon) === false) return track[i];
      return null;
    };
    const ag = landAt(pts);
    const rows = [
      el(
        "tr",
        { class: "cw-imdrow" },
        el("td", {}, el("span", { class: "cw-key", style: "--c:#fff" }), w.source === "nhc" ? `${agency} (official)` : `${agency} warning`),
        el("td", { text: ag ? `${latText(ag.lat)}, ${lonText(ag.lon)}` : "Stays at sea" }),
        el("td", { text: ag ? `≈ ${fmtShort(ag.t)}` : "" }),
        el("td", { class: "num", text: w.hPa ? `${w.hPa} hPa now` : "" })
      ),
    ];
    for (const m of models) {
      let where;
      let whenText = "";
      if (m.landfall) {
        where = `${latText(m.landfall.lat)}, ${lonText(m.landfall.lon)}`;
        whenText = `≈ ${fmtShort(m.landfall.t)}`;
      } else if (m.lost || m.track.length < 2) {
        where = "Low not found near the storm";
      } else {
        const last = m.track[m.track.length - 1];
        where = `Stays at sea, to ${latText(last.lat)} ${lonText(last.lon)}`;
        whenText = fmtShort(last.t);
      }
      rows.push(
        el(
          "tr",
          {},
          el("td", {}, el("span", { class: "cw-key", style: `--c:${m.colour}` }), m.name),
          el("td", { text: where }),
          el("td", { text: whenText }),
          el("td", { class: "num", text: m.lowest ? `${m.lowest} hPa` : "" })
        )
      );
    }
    $("cw-models").replaceChildren(el("thead", {}, head), el("tbody", {}, rows));
    const sp = modelSpread(models, pts);
    $("cw-spread").textContent = sp ? sp.text : "";
  }
  if (!steer) {
    $("cw-steer-status").textContent = `Couldn't read the GFS winds (${steerErr?.message || "no answer"}).`;
  } else {
    $("cw-steer-status").textContent = "";
    const head = el("tr", {}, ...["When (IST)", "Storm at", "Steering", "Ridge"].map((h) => el("th", { text: h })));
    const rows = steer.map((x) =>
      el(
        "tr",
        {},
        el("td", { text: fmtShort(x.t * 1000) }),
        el("td", { text: `${latText(x.lat)}, ${lonText(x.lon)}` }),
        el("td", { text: x.speed != null ? `→ ${abbr(compass(x.towards))} ${Math.round(x.speed)} km/h` : "—" }),
        el("td", { text: x.ridge != null ? latText(x.ridge) : "—" })
      )
    );
    $("cw-steer").replaceChildren(el("thead", {}, head), el("tbody", {}, rows));
    $("cw-steer-say").textContent = steerSay(steer);
  }
  renderWorldGlance(w);
  drawModels();
}

// ---- screen ----

const FC_TITLE = "IMD forecast track";
let fcFoot = "";

export function initCycloneWatch() {
  fcFoot = $("cw-p-fc").querySelector(".cw-foot").textContent;
  $("cw-img").addEventListener("error", () => show("cw-p-img", false));
  $("cw-refresh").addEventListener("click", () => {
    try {
      localStorage.removeItem(MODEL_CACHE);
    } catch {}
    refresh();
  });
}

export function showCycloneWatch() {
  if (Date.now() - loadedAt > 10 * 60 * 1000) refresh();
  else {
    if (map) setTimeout(() => map.invalidateSize(), 0);
    resizeTrackMap();
  }
}
