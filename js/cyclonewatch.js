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
// When nothing is active, it says so and keeps the MJO and the past storms.
import { km } from "./geo.js";
import { when } from "./offline.js";
import { fetchTrack } from "./cyclonetrack.js";
import { loadLeaflet } from "./stationmap.js";
import { placeNamed, shoreBetween, shoreAround, nearestPlace, meetsCoast, closestOnSegment } from "./coast.js";
import { MODELS, modelTracks, steering, compass } from "./cyclonemodels.js";

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
let state = null; // { b, hist, mjo, wfs, active, models, steer }

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
  const results = await Promise.allSettled([getData("latest.json"), getData("history.json"), getData("mjo.json"), fetchTrack()]);
  [b, hist, mjo, wfs] = results.map((r) => (r.status === "fulfilled" ? r.value : null));
  const offline = results[0].status === "rejected";
  if (offline) {
    try {
      saved = JSON.parse(localStorage.getItem(SAVED));
    } catch {}
    if (saved) ({ b, hist, mjo } = saved);
  } else {
    try {
      localStorage.setItem(SAVED, JSON.stringify({ at: Date.now(), b, hist, mjo }));
    } catch {}
  }
  const issued = Date.parse(b?.issued || "");
  const recent = Number.isFinite(issued) && Date.now() - issued < ACTIVE_HOURS * 3600 * 1000;
  const wfsLive = (wfs?.features || []).some((f) => f.geometry);
  state = { b, hist, mjo, wfs, active: recent || (wfsLive && !!b), wfsLive, issued };
  loadedAt = Date.now();
  render();
  if (offline) {
    say(saved ? `No connection. Showing what was saved ${when(saved.at)}.` : "Couldn't load the cyclone data. Check the connection and try again.", true);
  } else if (!b) {
    say("No cyclone bulletin has been read yet.");
  } else {
    say(`Updated ${new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}`);
  }
  if (state.active) loadModels();
}

// ---- rendering ----

function show(id, on) {
  $(id).hidden = !on;
}

function render() {
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
    $("cw-kicker").textContent = "Bay of Bengal & Arabian Sea";
    $("cw-stage").textContent = "No active cyclone";
    $("cw-name").textContent = "";
    $("cw-alert").hidden = true;
    const lf = $("cw-landfall");
    lf.hidden = false;
    lf.textContent = b
      ? `IMD has issued no bulletin since ${fmtTime(issued)} (${b.stage || "system"}${b.name ? ` ${b.name}` : ""}, ${b.system || ""}). This screen fills in when the next depression forms.`
      : "IMD has no depression or cyclone in its bulletins. This screen fills in when one forms.";
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
    const ridge = s0.ridge != null ? ` 500 hPa ridge near ${s0.ridge.toFixed(0)}°N, ${s0.ridge > s0.lat ? "north of the storm" : "at or south of the storm"}.` : "";
    items.push(["info", `Steering (GFS) now: towards the ${compass(s0.towards)} at ${Math.round(s0.speed)} km/h.${ridge}`]);
  }
  const m = mjo?.days?.[mjo.days.length - 1];
  if (m) items.push([mjoGood(m) ? "ok" : "info", `MJO phase ${m.phase}, amplitude ${m.amp.toFixed(1)}: ${mjoSay(m)}.`]);
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
const mjoGood = (m) => m.amp >= 1 && m.phase >= 2 && m.phase <= 5;
function mjoSay(m) {
  if (m.amp < 1) return "weak, little effect on the Bay of Bengal";
  if (m.phase >= 2 && m.phase <= 5) return `active over the ${MJO_AREA[m.phase]}, a phase when Bay of Bengal storms form and grow more readily`;
  return `active over the ${MJO_AREA[m.phase]}, a phase that usually holds back storms over the Bay`;
}

function renderMjo() {
  const { mjo } = state;
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
    el("p", { class: `cw-verdict ${mjoGood(m) ? "cw-ok" : ""}`, text: `${mjoSay(m).replace(/^./, (c) => c.toUpperCase())}.` }),
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
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · Track: IMD',
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
  const parts = [
    `<span class="cw-key" style="--c:#ff5252"></span>Observed`,
    `<span class="cw-key cw-dash" style="--c:#fff"></span>IMD forecast`,
    `<span class="cw-key cw-thick" style="--c:#ff9800"></span>IMD landfall zone`,
  ];
  for (const m of state.models || []) if (m.track.length > 1) parts.push(`<span class="cw-key" style="--c:${m.colour}"></span>${m.name}`);
  $("cw-legend").innerHTML = parts.map((p) => `<span>${p}</span>`).join("");
}

// ---- Models and steering ----

async function loadModels() {
  const { b } = state;
  const pts = forecastPoints(b);
  const start = b.at ? { lat: b.lat, lon: b.lon, t: Date.parse(b.at) } : pts[0];
  if (!start?.lat) {
    $("cw-models-status").textContent = "IMD's position isn't in the bulletin, so the models can't be followed.";
    return;
  }
  const key = `${b.system}-${b.no}`;
  let cache = null;
  try {
    cache = JSON.parse(localStorage.getItem(MODEL_CACHE));
  } catch {}
  if (cache?.key === key && Date.now() - cache.at < MODEL_TTL) {
    Object.assign(state, { models: cache.models, steer: cache.steer });
    afterModels(cache.at);
    return;
  }
  $("cw-models-status").textContent = `Reading ${MODELS.length} models…`;
  $("cw-steer-status").textContent = "Reading GFS winds…";
  // Steering at IMD's position now and every 24 hours along its track, up to
  // the coast.
  const cross = crossing(pts);
  const end = cross ? cross.t : pts[pts.length - 1]?.t;
  const along = [];
  for (let t = start.t; end && t <= end; t += 24 * 3600000) {
    const p = t === start.t ? start : positionAt(pts, t);
    if (p) along.push({ t: Math.round(t / 1000), lat: p.lat, lon: p.lon });
  }
  const [mr, sr] = await Promise.allSettled([modelTracks({ lat: start.lat, lon: start.lon, t: Math.round(start.t / 1000) }), steering(along)]);
  const models = mr.status === "fulfilled" ? mr.value.map(slim) : null;
  const steer = sr.status === "fulfilled" ? sr.value : null;
  state.models = models;
  state.steer = steer;
  if (models && steer) {
    try {
      localStorage.setItem(MODEL_CACHE, JSON.stringify({ key, at: Date.now(), models, steer }));
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
    landfall: m.landfall ? { t: m.landfall.t * 1000, lat: m.landfall.lat, lon: m.landfall.lon, place: { name: m.landfall.place.name, state: m.landfall.place.state } } : null,
    lowest: m.lowest != null ? Math.round(m.lowest) : null,
    lost: !!m.lost,
  };
}

function afterModels(at, modelErr, steerErr) {
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
        el("td", { text: s.ridge != null ? `${s.ridge.toFixed(1)}°N` : "—" })
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
    const d = r[r.length - 1].ridge - r[0].ridge;
    const move = Math.abs(d) < 1 ? "stays near" : d > 0 ? `moves north to` : `moves south to`;
    out.push(`The ridge ${move} ${r[r.length - 1].ridge.toFixed(0)}°N by ${fmtTime(r[r.length - 1].t * 1000)}.`);
    const last = r[r.length - 1];
    if (last.ridge - last.lat < 2) out.push("By then the storm is close to the ridge's latitude, where storms often turn north.");
    else out.push("The ridge stays north of the storm, which favours a westward or northwestward track.");
  }
  return out.join(" ");
}

// ---- screen ----

export function initCycloneWatch() {
  $("cw-refresh").addEventListener("click", () => {
    try {
      localStorage.removeItem(MODEL_CACHE);
    } catch {}
    refresh();
  });
}

export function showCycloneWatch() {
  if (Date.now() - loadedAt > 10 * 60 * 1000) refresh();
  else if (map) setTimeout(() => map.invalidateSize(), 0);
}
