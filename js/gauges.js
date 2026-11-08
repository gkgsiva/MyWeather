// TN rain gauges (#gauges): the Tamil Nadu government's automatic rain gauges
// (TN-SMART, run with RIMES), about 1,500 across the state, 115 in Chennai.
// Each gauge reports rain every hour of the rain day, 8:30 AM to 8:30 AM IST.
// Three tabs share one set of filters (district, rain, search): a map, a
// sortable table and charts.
//
// Source: the public hourly page
//   https://beta-tnsmart.rimes.int/index.php/RTDAS/Hourly_data_TNDRRA_c/public
// reads one JSON file per rain day, named by the day it ends on:
//   https://beta-tnsmart.rimes.int/Rainfall_Python_IDW/Hourly_json/hourly_rainfall_<YYYY-MM-DD>.json
// Rows: { district_name, station_name, latitude, longitude, "09:30 AM": mm, … "08:30 AM": mm, total }.
// A gauge that sent nothing has total null. The site allows cross-site reads.
import { loadLeaflet, isDark } from "./stationmap.js";
import { drawBars } from "./chart.js";
import { getDays, missing, daysEnding, remember, weeklyNormals, imdDistrict, gaugeKey, niceDay as dayLabel } from "./gaugedays.js";
import { IN_APP, routeParams } from "./route.js";

const BASE = "https://beta-tnsmart.rimes.int/Rainfall_Python_IDW/Hourly_json/";
const PAGE = "https://beta-tnsmart.rimes.int/index.php/RTDAS/Hourly_data_TNDRRA_c/public";
const AREA_KEY = "myweather.gauges.area";
const TAB_KEY = "myweather.gauges.tab";
const PAGE_ROWS = 100;
const TTL = 10 * 60 * 1000;
const HOUR_RE = /^\d\d:\d\d [AP]M$/;

const $ = (id) => document.getElementById(id);
const status = $("tg-status");
const dateInput = $("tg-date");
const areaPick = $("tg-area");
const showPick = $("tg-show");
const minPick = $("tg-min");
const search = $("tg-search");
const table = $("tg-table");
const countLine = $("tg-count");
const moreBtn = $("tg-more");
const box = $("tg-map");
const legend = $("tg-legend");
const summary = $("tg-summary");
const gaugeName = $("tg-gauge-name");
const gaugeChart = $("tg-gauge-chart");
const gaugeReadout = $("tg-gauge-readout");
const areaHead = $("tg-area-head");
const areaChart = $("tg-area-chart");
const areaReadout = $("tg-area-readout");
const topHead = $("tg-top-head");
const topList = $("tg-top");
const districtBox = $("tg-districts");
const districtList = $("tg-district-list");

let L = null;
let map = null;
let tiles = null;
let layer = null;
let rows = []; // reporting and silent gauges of the loaded day
let hours = []; // "09:30 AM" … in order
let loadedDay = "";
let loadedAt = 0;
let picked = null; // the gauge whose chart is shown
let fitted = "";
let sortKey = "total";
let sortDir = -1;
let tableRows = PAGE_ROWS;
let tab = "map";
let userDay = false; // a day picked in the date box, not the running one
let pendingGauge = ""; // "district|station" from a link (#gauges?gauge=…), e.g. Home's nearest gauge

function say(text, error = false) {
  status.textContent = text;
  status.className = error ? "status error" : "status";
}

// ---- Dates (IST) ----

const pad = (n) => String(n).padStart(2, "0");
const key = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
// Clock time in India as a Date whose UTC fields read as IST.
const istNow = () => new Date(Date.now() + 5.5 * 3600 * 1000);
function shiftDay(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return key(d);
}
// The rain day running now ends at 8:30 AM today, or tomorrow once 8:30 has passed.
function currentRainDay() {
  const t = istNow();
  const after = t.getUTCHours() * 60 + t.getUTCMinutes() >= 8 * 60 + 30;
  return after ? shiftDay(key(t), 1) : key(t);
}
const niceDay = (day) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const short = (h) => h.replace(":30", "").replace(/^0/, "").replace(" AM", "a").replace(" PM", "p");

// ---- Colours: IMD's daily rain bands ----

const BANDS = [
  [0.01, "#9aa4af", "None"],
  [2.5, "#9fd3ff", "< 2.5"],
  [15.6, "#4aa3ff", "2.5–15.5"],
  [64.5, "#1565c0", "15.6–64.4"],
  [115.6, "#7b1fa2", "64.5–115.5"],
  [204.5, "#c2185b", "115.6–204.4"],
  [Infinity, "#b71c1c", "204.5+"],
];
// An hour's rain: light, moderate, heavy, very heavy.
const HOUR_BANDS = [
  [0.01, "#9aa4af", "None"],
  [2.5, "#9fd3ff", "< 2.5"],
  [7.6, "#4aa3ff", "2.5–7.5"],
  [35.6, "#1565c0", "7.6–35.5"],
  [Infinity, "#7b1fa2", "35.6+"],
];
const LIGHT = new Set(["#9fd3ff", "#9aa4af", "#4aa3ff"]);
const colourOf = (bands, v) => (typeof v === "number" ? bands.find(([max]) => v < max)[1] : "#9aa4af");
const fmt = (v) => (typeof v === "number" ? (Math.round(v * 10) / 10).toFixed(v % 1 ? 1 : 0) : "–");

// ---- Data ----

// The last hour with a reading at any gauge of the filtered list (later hours
// are still to come; Chennai's gauges often report an hour or two late).
let lastIdx = -1;
const lastHourIndex = () => lastIdx;
function findLastHour(list) {
  for (let i = hours.length - 1; i >= 0; i--) if (list.some((r) => typeof r[hours[i]] === "number")) return i;
  return -1;
}

async function fetchDay(day) {
  const res = await fetch(`${BASE}hourly_rainfall_${day}.json?t=${Date.now()}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function load(force = false) {
  let day = userDay && dateInput.value ? dateInput.value : currentRainDay();
  if (!force && day === loadedDay && Date.now() - loadedAt < TTL) return draw();
  say("Loading the rain gauges…");
  try {
    let data = await fetchDay(day);
    // Just after 8:30 AM the new day's file may not exist yet.
    if (!data && !userDay) {
      day = shiftDay(day, -1);
      data = await fetchDay(day);
    }
    if (!data) {
      rows = [];
      loadedDay = day;
      draw();
      say(`No gauge data for the rain day ending ${niceDay(day)}.`, true);
      return;
    }
    rows = data.filter((r) => typeof r.latitude === "number" && typeof r.longitude === "number");
    remember(day, data);
    hours = Object.keys(data[0] || {}).filter((k) => HOUR_RE.test(k));
    loadedDay = day;
    loadedAt = Date.now();
    dateInput.value = day;
    fillAreas();
    const want = pendingGauge && rows.find((r) => gaugeKey(r) === pendingGauge);
    pendingGauge = "";
    if (want) {
      areaPick.value = want.district_name;
      picked = want;
      setTab("map");
      fitted = "";
    }
    picked = picked && rows.find((r) => r.station_name === picked.station_name && r.district_name === picked.district_name);
    draw();
    if (want) setTimeout(() => focus(picked), 50);
    const on = rows.filter((r) => typeof r.total === "number").length;
    const last = findLastHour(rows);
    say(
      `Rain day ${niceDay(shiftDay(day, -1))} 8:30 AM to ${niceDay(day)} 8:30 AM · ${on} of ${rows.length} gauges reporting` +
        (last >= 0 ? ` · up to ${hours[last]}` : "")
    );
  } catch (e) {
    say(`Couldn't load the gauges (${e.message}). Check the connection and try again.`, true);
  }
}

// ---- Area picker ----

function fillAreas() {
  const districts = [...new Set(rows.map((r) => r.district_name))].sort();
  const keep = areaPick.value;
  areaPick.replaceChildren(new Option("All Tamil Nadu", "all"), ...districts.map((d) => new Option(d, d)));
  areaPick.value = districts.includes(keep) ? keep : "all";
}
function inArea() {
  const min = minPick.value;
  const q = search.value.trim().toLowerCase();
  return rows.filter((r) => {
    if (areaPick.value !== "all" && r.district_name !== areaPick.value) return false;
    if (min === "none" ? typeof r.total === "number" : min && !(r.total >= Number(min))) return false;
    if (q && !r.station_name.toLowerCase().includes(q) && !r.district_name.toLowerCase().includes(q)) return false;
    return true;
  });
}
const areaName = () => (areaPick.value === "all" ? "Tamil Nadu" : areaPick.value);
// The wettest single hour at a gauge.
const peakOf = (r) => {
  const v = hours.map((h) => r[h]).filter((x) => typeof x === "number");
  return v.length ? Math.max(...v) : null;
};
const valueOf = (r) => (showPick.value === "hour" ? r[hours[lastHourIndex()]] : r.total);

// ---- Map ----

function setTiles() {
  box.classList.toggle("dark-tiles", isDark());
  if (tiles) return;
  tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · gauges: TN-SMART',
  }).addTo(map);
}

function ensureMap() {
  if (map) return;
  map = L.map(box, { preferCanvas: true }).setView([13.04, 80.22], 10);
  layer = L.layerGroup().addTo(map);
  setTiles();
  // Numbered pins once zoomed in far enough to tell them apart.
  let wasPins = false;
  map.on("zoomend", () => {
    const pinsNow = map.getZoom() >= 12;
    if (pinsNow !== wasPins && rows.length) drawMap(inArea());
    wasPins = pinsNow;
  });
  new MutationObserver(setTiles).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}

function renderLegend() {
  const bands = showPick.value === "hour" ? HOUR_BANDS : BANDS;
  legend.replaceChildren(
    ...bands.map(([, c, label]) => {
      const s = document.createElement("span");
      s.style.setProperty("--level", c);
      s.textContent = label;
      return s;
    }),
    Object.assign(document.createElement("small"), { textContent: "mm" })
  );
}

function popup(r) {
  const div = document.createElement("div");
  div.className = "map-pop";
  const t = document.createElement("strong");
  t.textContent = r.station_name;
  const s = document.createElement("span");
  const last = lastHourIndex();
  s.textContent =
    typeof r.total === "number"
      ? `${fmt(r.total)} mm this rain day · ${fmt(r[hours[last]])} mm in the hour to ${hours[last]}`
      : "No data from this gauge";
  const d = document.createElement("small");
  d.textContent = r.district_name;
  div.append(t, s, d);
  return div;
}

function drawMap(list) {
  if (!map) return;
  layer.clearLayers();
  const bands = showPick.value === "hour" ? HOUR_BANDS : BANDS;
  // Numbered pins are readable for a district; all of Tamil Nadu gets dots.
  const pins = list.length <= 60 || map.getZoom() >= 12;
  // Driest first, so the wettest are drawn on top.
  const sorted = [...list].sort((a, b) => (valueOf(a) ?? -1) - (valueOf(b) ?? -1));
  for (const r of sorted) {
    const v = valueOf(r);
    const c = colourOf(bands, v);
    const pos = [r.latitude, r.longitude];
    let m;
    if (pins) {
      const icon = L.divIcon({
        className: "",
        html: `<span class="pin${typeof v === "number" ? "" : " off"}" style="background:${c};color:${LIGHT.has(c) ? "#111" : "#fff"}">${fmt(v)}</span>`,
        iconSize: null,
      });
      m = L.marker(pos, { icon, title: r.station_name });
    } else {
      m = L.circleMarker(pos, {
        radius: typeof v === "number" && v > 0 ? 6 : 4,
        color: "rgba(0,0,0,.45)",
        weight: 1,
        fillColor: c,
        fillOpacity: typeof v === "number" ? 0.95 : 0.35,
      });
    }
    m.bindPopup(() => popup(r));
    m.on("click", () => pick(r));
    m.addTo(layer);
  }
  const fitKey = `${areaPick.value}|${minPick.value}|${search.value}`;
  if (fitted !== fitKey && list.length && box.offsetWidth) {
    map.fitBounds(L.latLngBounds(list.map((r) => [r.latitude, r.longitude])), { padding: [16, 16], maxZoom: 12 });
    fitted = fitKey;
  }
}

// ---- Charts ----

function hourBars(values, label) {
  const last = lastHourIndex();
  return hours.map((h, i) => ({
    tick: i % 3 === 0 ? short(h) : "",
    value: i > last ? undefined : values[i],
    text: i > last ? `${h}: not yet` : `${label}${h}: ${typeof values[i] === "number" ? `${fmt(values[i])} mm` : "no data"}`,
  }));
}

function pick(r) {
  picked = r;
  drawGauge();
  drawHistory();
}

function drawGauge() {
  const r = picked;
  if (!r) {
    gaugeName.textContent = "Tap a gauge on the map";
    drawBars(gaugeChart, gaugeReadout, hourBars([], ""), "Its rain hour by hour shows here.");
    return;
  }
  gaugeName.textContent = `${r.station_name} · ${r.district_name} · ${fmt(r.total)} mm`;
  drawBars(
    gaugeChart,
    gaugeReadout,
    hourBars(
      hours.map((h) => r[h]),
      ""
    ),
    typeof r.total === "number" ? "Tap a bar for that hour." : "This gauge sent no data for the day."
  );
}

// ---- History of the picked gauge: the last 7 or 30 rain days ----

let histDays = 0; // 0 until asked for; then 7 or 30
let histRun = 0;
const histHead = $("tg-hist-head");
const histChart = $("tg-hist-chart");
const histReadout = $("tg-hist-readout");
const histNote = $("tg-hist-note");

function paintHistButtons() {
  for (const b of document.querySelectorAll("#tg-hist-pick button")) b.setAttribute("aria-pressed", String(Number(b.dataset.days) === histDays));
}

async function drawHistory() {
  const r = picked;
  paintHistButtons();
  if (!r) {
    histHead.textContent = "Past days";
    histChart.replaceChildren();
    histReadout.textContent = "";
    histNote.textContent = "Tap a gauge on the map first.";
    return;
  }
  histHead.textContent = `${r.station_name}: past days`;
  if (!histDays) {
    histChart.replaceChildren();
    histReadout.textContent = "";
    histNote.textContent =
      "Tap 7 days or 30 days for this gauge's rain each day, against the district and IMD's normal. " +
      "Each day is about 0.7 MB the first time; after that it is kept on the phone.";
    return;
  }
  const run = ++histRun;
  const days = daysEnding(loadedDay, histDays);
  const need = await missing(days);
  histNote.textContent = need ? `Downloading ${need} day${need > 1 ? "s" : ""} (about ${Math.max(1, Math.round(need * 0.7))} MB)…` : "Loading…";
  const got = await getDays(days, (done, total) => {
    if (run === histRun && need) histNote.textContent = `Downloading… ${done} of ${total} days`;
  });
  if (run !== histRun) return;
  const key = gaugeKey(r);
  const values = [];
  const districtAvg = [];
  for (const d of got) {
    if (!d) {
      values.push(undefined);
      districtAvg.push(null);
      continue;
    }
    const g = d.gauges.find((x) => `${x[0]}|${x[1]}` === key);
    values.push(g ? g[4] : null);
    const inD = d.gauges.filter((x) => x[0] === r.district_name && typeof x[4] === "number");
    districtAvg.push(inD.length ? inD.reduce((a, x) => a + x[4], 0) / inD.length : null);
  }
  const every = histDays > 10 ? 5 : 1;
  drawBars(
    histChart,
    histReadout,
    days.map((day, i) => ({
      tick: (days.length - 1 - i) % every === 0 ? dayLabel(day, { month: undefined }) : "",
      value: values[i],
      partial: i === days.length - 1 && day === loadedDay && !userDay,
      text:
        values[i] === undefined
          ? `${dayLabel(day)}: couldn't download`
          : `Rain day ending ${dayLabel(day)}: ${typeof values[i] === "number" ? `${fmt(values[i])} mm` : "no data"}` +
            (typeof districtAvg[i] === "number" ? ` · ${r.district_name} average ${fmt(districtAvg[i])} mm` : ""),
    })),
    "Tap a bar for that day."
  );
  const sum = (a) => a.filter((v) => typeof v === "number").reduce((x, y) => x + y, 0);
  const reported = values.filter((v) => typeof v === "number").length;
  const total = sum(values);
  const dTotal = sum(districtAvg);
  let text =
    `${fmt(total)} mm in ${histDays} days to ${dayLabel(loadedDay)}` +
    (reported < histDays ? ` (${reported} days with data)` : "") +
    ` · ${r.district_name} average ${fmt(dTotal)} mm.`;
  histNote.textContent = text;
  try {
    const n = await weeklyNormals();
    if (run !== histRun) return;
    const a = n.areas[imdDistrict(r.district_name)];
    if (a && a.normal > 0) {
      const normal = (a.normal * histDays) / 7;
      const dep = Math.round(((total - normal) / normal) * 100);
      text +=
        ` IMD's normal for ${r.district_name} is ${fmt(a.normal)} mm a week at this time of year` +
        (histDays === 7 ? "" : `, so about ${fmt(normal)} mm for ${histDays} days`) +
        `: this gauge is ${dep >= 0 ? `${dep}% above` : `${-dep}% below`} normal.`;
    }
  } catch {
    if (!IN_APP) text += " (IMD's normal can only be read inside the app.)";
  }
  histNote.textContent = text;
}

function drawArea(list) {
  const name = areaName();
  const avg = hours.map((h) => {
    const v = list.map((r) => r[h]).filter((x) => typeof x === "number");
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  });
  const max = hours.map((h) => {
    const v = list.map((r) => r[h]).filter((x) => typeof x === "number");
    return v.length ? Math.max(...v) : null;
  });
  areaHead.textContent = `${name}: average rain per hour`;
  const last = lastHourIndex();
  drawBars(
    areaChart,
    areaReadout,
    hours.map((h, i) => ({
      tick: i % 3 === 0 ? short(h) : "",
      value: i > last ? undefined : avg[i],
      text:
        i > last
          ? `${h}: not yet`
          : `${h}: ${fmt(avg[i])} mm on average · wettest gauge ${fmt(max[i])} mm`,
    })),
    "Tap a bar for the hour's average and wettest gauge.",
    { peak: (v) => v.toFixed(1) }
  );
}

// A ranked list with a bar under each name.
function rankList(ol, items, max) {
  ol.replaceChildren(
    ...items.map(({ name, sub, value, onClick }) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "rank-row";
      btn.innerHTML = `<span class="rank-name"></span><span class="rank-val"></span><span class="rank-bar"><i></i></span>`;
      btn.querySelector(".rank-name").textContent = sub ? `${name} · ${sub}` : name;
      btn.querySelector(".rank-val").textContent = `${fmt(value)} mm`;
      const bar = btn.querySelector("i");
      bar.style.width = `${max > 0 ? Math.max(1, (value / max) * 100) : 0}%`;
      bar.style.background = colourOf(BANDS, value);
      btn.addEventListener("click", onClick);
      li.append(btn);
      return li;
    })
  );
}

function focus(r) {
  setTab("map");
  pick(r);
  if (!map) return;
  map.setView([r.latitude, r.longitude], Math.max(map.getZoom(), 12));
  map.invalidateSize();
  box.scrollIntoView({ behavior: "smooth", block: "center" });
}

function drawTop(list) {
  const name = areaName();
  const top = list
    .filter((r) => typeof r.total === "number")
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);
  topHead.textContent = `Wettest gauges in ${name}`;
  rankList(
    topList,
    top.map((r) => ({
      name: r.station_name,
      sub: areaPick.value === "all" ? r.district_name : "",
      value: r.total,
      onClick: () => focus(r),
    })),
    top[0]?.total || 0
  );
}

function drawDistricts() {
  districtBox.hidden = areaPick.value !== "all";
  if (districtBox.hidden) return;
  const by = new Map();
  const keep = areaPick.value;
  areaPick.value = "all";
  const all = inArea();
  areaPick.value = keep;
  for (const r of all) {
    if (typeof r.total !== "number") continue;
    const d = by.get(r.district_name) || { sum: 0, n: 0, max: 0 };
    d.sum += r.total;
    d.n++;
    d.max = Math.max(d.max, r.total);
    by.set(r.district_name, d);
  }
  const list = [...by]
    .map(([name, d]) => ({ name, avg: d.sum / d.n, n: d.n, max: d.max }))
    .sort((a, b) => b.avg - a.avg);
  rankList(
    districtList,
    list.map((d) => ({
      name: d.name,
      sub: `${d.n} gauges, wettest ${fmt(d.max)} mm`,
      value: d.avg,
      onClick: () => {
        areaPick.value = d.name;
        areaPick.dispatchEvent(new Event("change"));
        status.scrollIntoView({ behavior: "smooth", block: "start" });
      },
    })),
    list[0]?.avg || 0
  );
}

function drawSummary(list) {
  const on = list.filter((r) => typeof r.total === "number");
  if (!on.length) {
    summary.textContent = "";
    return;
  }
  const avg = on.reduce((a, r) => a + r.total, 0) / on.length;
  const wet = on.filter((r) => r.total >= 0.1).length;
  const heavy = on.filter((r) => r.total >= 64.5).length;
  const top = on.reduce((a, r) => (r.total > a.total ? r : a));
  summary.textContent =
    `Average ${fmt(avg)} mm · rain at ${wet} of ${on.length} gauges` +
    (heavy ? ` · ${heavy} heavy (64.5 mm+)` : "") +
    ` · wettest ${top.station_name} ${fmt(top.total)} mm`;
}

// How many gauges fall in each of IMD's daily bands.
function drawBands(list) {
  const counts = BANDS.map(() => 0);
  let none = 0;
  for (const r of list) {
    if (typeof r.total !== "number") none++;
    else counts[BANDS.findIndex(([max]) => r.total < max)]++;
  }
  const names = ["No rain", "Very light", "Light", "Moderate", "Heavy", "Very heavy", "Extreme"];
  const svg = $("tg-band-chart");
  drawBars(
    svg,
    $("tg-band-readout"),
    BANDS.map(([, c, label], i) => ({
      tick: ["0", "<2.5", "2.5", "15.6", "64.5", "115", "204"][i],
      value: counts[i],
      cls: `band-${i}`,
      text: `${names[i]} (${label} mm): ${counts[i]} gauges`,
    })),
    `Tap a bar for the count.${none ? ` ${none} gauges sent no data.` : ""}`,
    { unit: "gauges", peak: (v) => String(v) }
  );
  svg.querySelectorAll(".bar .fill").forEach((el, k) => {
    // Bars with a value only; colour each by its band.
    const i = [...svg.querySelectorAll(".bar")].indexOf(el.closest(".bar"));
    el.style.fill = BANDS[i][1];
  });
}

// How many gauges had rain in each hour: shows when the rain was widespread.
function drawWet(list) {
  const last = lastHourIndex();
  const on = list.filter((r) => typeof r.total === "number").length;
  $("tg-wet-head").textContent = `Gauges with rain each hour (of ${on})`;
  drawBars(
    $("tg-wet-chart"),
    $("tg-wet-readout"),
    hours.map((h, i) => {
      const n = list.filter((r) => r[h] >= 0.1).length;
      return {
        tick: i % 3 === 0 ? short(h) : "",
        value: i > last ? undefined : n,
        text: i > last ? `${h}: not yet` : `${h}: rain at ${n} gauges`,
      };
    }),
    "Tap a bar for the hour.",
    { unit: "gauges", peak: (v) => String(v) }
  );
}

// ---- Table ----

function sortValue(r, key) {
  if (key === "last") return r[hours[lastHourIndex()]];
  if (key === "peak") return peakOf(r);
  return r[key];
}

function drawTable(list) {
  const sorted = [...list].sort((a, b) => {
    const x = sortValue(a, sortKey);
    const y = sortValue(b, sortKey);
    if (typeof x === "string" || typeof y === "string") return sortDir * String(x ?? "").localeCompare(String(y ?? ""));
    // Gauges without data go last either way.
    if (x == null || y == null) return (x == null) - (y == null);
    return sortDir * (x - y);
  });
  for (const th of table.querySelectorAll("th[data-sort]")) {
    if (th.dataset.sort === sortKey) th.setAttribute("aria-sort", sortDir < 0 ? "descending" : "ascending");
    else th.removeAttribute("aria-sort");
  }
  const last = hours[lastHourIndex()];
  const body = table.tBodies[0];
  body.replaceChildren(
    ...sorted.slice(0, tableRows).map((r) => {
      const tr = document.createElement("tr");
      const cells = [r.station_name, r.district_name, fmt(r.total), fmt(r[last]), fmt(peakOf(r))];
      cells.forEach((text, i) => {
        const td = document.createElement(i ? "td" : "th");
        if (!i) td.scope = "row";
        if (i === 2) {
          const dot = document.createElement("span");
          dot.className = "dot";
          dot.style.setProperty("--level", colourOf(BANDS, r.total));
          td.append(dot);
        }
        td.append(text);
        tr.append(td);
      });
      tr.addEventListener("click", () => focus(r));
      return tr;
    })
  );
  countLine.textContent = `${list.length} gauges${list.length > tableRows ? `, showing ${tableRows}` : ""}${last ? ` · last hour is the hour to ${last}` : ""}`;
  moreBtn.hidden = list.length <= tableRows;
}

// ---- Tabs ----

function setTab(name) {
  tab = name;
  for (const b of document.querySelectorAll("#view-gauges [role=tab]")) b.setAttribute("aria-selected", String(b.dataset.tab === name));
  for (const t of ["map", "table", "charts"]) $(`tg-tab-${t}`).hidden = t !== name;
  try {
    localStorage.setItem(TAB_KEY, name);
  } catch {}
  if (name === "map" && map)
    setTimeout(() => {
      map.invalidateSize();
      if (rows.length) drawMap(inArea());
    }, 0);
}

function draw() {
  const list = inArea();
  lastIdx = findLastHour(list);
  renderLegend();
  drawMap(list);
  drawSummary(list);
  if (!picked) picked = [...list].filter((r) => typeof r.total === "number").sort((a, b) => b.total - a.total)[0] || null;
  drawGauge();
  drawHistory();
  drawTable(list);
  drawArea(list);
  drawBands(list);
  drawWet(list);
  drawTop(list);
  drawDistricts();
}

// ---- Screen ----

export function initGauges() {
  try {
    const a = localStorage.getItem(AREA_KEY);
    if (a) areaPick.replaceChildren(new Option(a === "all" ? "All Tamil Nadu" : a, a));
  } catch {}
  if (!areaPick.value) areaPick.replaceChildren(new Option("All Tamil Nadu", "all"));
  dateInput.max = currentRainDay();
  areaPick.addEventListener("change", () => {
    try {
      localStorage.setItem(AREA_KEY, areaPick.value);
    } catch {}
    picked = null;
    tableRows = PAGE_ROWS;
    draw();
  });
  showPick.addEventListener("change", draw);
  minPick.addEventListener("change", () => {
    picked = null;
    tableRows = PAGE_ROWS;
    draw();
  });
  let typing = 0;
  search.addEventListener("input", () => {
    clearTimeout(typing);
    typing = setTimeout(() => {
      picked = null;
      tableRows = PAGE_ROWS;
      draw();
    }, 250);
  });
  for (const th of table.querySelectorAll("th[data-sort]")) {
    th.addEventListener("click", () => {
      const k = th.dataset.sort;
      sortDir = k === sortKey ? -sortDir : k === "station_name" || k === "district_name" ? 1 : -1;
      sortKey = k;
      drawTable(inArea());
    });
  }
  moreBtn.addEventListener("click", () => {
    tableRows += PAGE_ROWS;
    drawTable(inArea());
  });
  for (const b of document.querySelectorAll("#view-gauges [role=tab]")) b.addEventListener("click", () => setTab(b.dataset.tab));
  try {
    const t = localStorage.getItem(TAB_KEY);
    if (["map", "table", "charts"].includes(t)) setTab(t);
  } catch {}
  dateInput.addEventListener("change", () => {
    userDay = Boolean(dateInput.value);
    picked = null;
    load(true);
  });
  $("tg-refresh").addEventListener("click", () => load(true));
  $("tg-today").addEventListener("click", () => {
    userDay = false;
    picked = null;
    load(true);
  });
  $("tg-source").href = PAGE;
  for (const b of document.querySelectorAll("#tg-hist-pick button"))
    b.addEventListener("click", () => {
      histDays = Number(b.dataset.days);
      drawHistory();
    });
}

export async function showGauges() {
  const want = routeParams().get("gauge");
  if (want) {
    pendingGauge = want;
    const r = rows.find((x) => gaugeKey(x) === want);
    if (r) {
      pendingGauge = "";
      areaPick.value = r.district_name;
      picked = r;
      setTab("map");
      fitted = "";
      draw();
      setTimeout(() => focus(r), 50);
    }
  }
  try {
    L = await loadLeaflet();
    ensureMap();
    setTimeout(() => {
      map.invalidateSize();
      fitted = ""; // fit again now the box has its size
      if (rows.length) drawMap(inArea());
    }, 0);
  } catch (e) {
    say(`Couldn't open the map (${e.message}).`, true);
  }
  load();
}
