// IMD daily report (#imdreport): RMC Chennai's Daily Weather Report for Tamil
// Nadu, Puducherry and Karaikal, as charts and tables.
//
// The report is a 6 MB PDF issued every afternoon. The "IMD daily report"
// workflow (.github/workflows/imd-daily-report.yml) reads it with
// scripts/imd_daily_report.py and puts the figures as JSON, plus the report's
// map pages as pictures, on the repository's `data` branch. This screen reads
// those few kilobytes from raw.githubusercontent.com (which sends a CORS
// header, so the website works too). history.json holds a short line for
// every day read so far, for the charts over days.
import { when } from "./offline.js";
import { drawBars, drawLines } from "./chart.js";
import { toTemp, toTempDelta, tempUnit } from "./prefs.js";
import { initSnaps } from "./snap.js";

export const DATA = "https://raw.githubusercontent.com/gkgsiva/MyWeather/data/daily-report/";
export const PDF = "https://mausam.imd.gov.in/chennai/mcdata/daily_weather_report.pdf";
const SAVED_KEY = "myweather.imdreport.latest";
const TTL = 15 * 60 * 1000;

const $ = (id) => document.getElementById(id);
const status = $("ir-status");
const datePick = $("ir-date");
const sortPick = $("ir-temp-sort");
const histStation = $("ir-hist-station");
const histWhat = $("ir-hist-what");

let latest = null; // the newest report
let shownReport = null;
let history = null; // { days: [...] }
let loadedAt = 0;
const byDate = new Map();

function say(text, error = false) {
  status.textContent = text;
  status.className = error ? "status error" : "status";
}

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const f1 = (v) => (isNum(v) ? v.toFixed(1) : "–");
const t1 = (c) => (isNum(c) ? toTemp(c).toFixed(1) : "–");
const sign = (v, digits = 1) => (isNum(v) ? `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(digits)}` : "–");
const dt = (c) => sign(isNum(c) ? toTempDelta(c) : c);
const mmTxt = (v) => (isNum(v) ? (v >= 100 ? String(Math.round(v)) : v.toFixed(1)) : "–");

// "Madurai_AP" → "Madurai AP", "KarurParamathi" → "Karur Paramathi".
export const niceName = (s) =>
  String(s || "")
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();

const longDate = (iso) =>
  iso
    ? new Date(`${iso}T12:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
    : "";
const shortDate = (iso) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "");

function issuedTime(hhmm) {
  if (!/^\d{4}$/.test(hhmm || "")) return "";
  const h = Number(hhmm.slice(0, 2));
  const m = hhmm.slice(2);
  return `${((h + 11) % 12) + 1}:${m} ${h < 12 ? "AM" : "PM"}`;
}

// IMD's categories: CAT code → CSS class (colours shared with the Monsoon screen).
const CAT = { LE: "le", E: "e", N: "n", D: "d", LD: "ld", NR: "nr" };
const CAT_NAME = { LE: "Large excess", E: "Excess", N: "Normal", D: "Deficient", LD: "Large deficient", NR: "No rain" };
const SPATIAL = { ISOL: "Isolated", SCT: "Scattered", FWS: "Fairly widespread", WS: "Widespread" };

// Temperature departure → class, by IMD's bands.
function depClass(d) {
  if (!isNum(d)) return "";
  if (d >= 5.1) return "dep-hot3";
  if (d >= 3.1) return "dep-hot2";
  if (d >= 1.6) return "dep-hot1";
  if (d <= -5.1) return "dep-cold3";
  if (d <= -3.1) return "dep-cold2";
  if (d <= -1.6) return "dep-cold1";
  return "dep-normal";
}

function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "style") e.style.cssText = v;
    else e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k instanceof Node ? k : String(k));
  return e;
}

async function getJson(name) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    // raw.githubusercontent.com caches for 5 minutes; the bucket keeps the
    // phone's own cache from holding an old copy for longer.
    const res = await fetch(`${DATA}${name}?t=${Math.floor(Date.now() / 300000)}`, { signal: ctrl.signal, cache: "no-cache" });
    if (res.status === 404) throw new Error("not published yet");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------ highlights

function tile(label, value, sub, cls = "") {
  return h("div", { class: `ir-tile ${cls}` }, h("small", {}, label), h("strong", {}, value), sub ? h("span", {}, sub) : null);
}

function renderHighlights(r) {
  const s = r.summary || {};
  $("ir-heading").textContent =
    `${longDate(r.date)}: observations to 8:30 AM${r.issued ? `, issued ${issuedTime(r.issued)}` : ""}.`;
  const tiles = [];
  const hr = s.highestRain;
  if (hr) tiles.push(tile("Highest rain", `${f1(hr.mm)} mm`, `${hr.place} (${hr.district})`, "ir-rain"));
  else if (hr === null) tiles.push(tile("Highest rain", "None", "No rain reported", "ir-rain"));
  for (const e of s.extremes || []) {
    const hill = /hill/i.test(e.where);
    const label = e.what === "max" ? "Highest max" : hill ? "Lowest min · hills" : "Lowest min · plains";
    tiles.push(tile(label, `${t1(e.value)}${tempUnit()}`, niceName(e.places).replace(/\s*&\s*/g, " & "), e.what === "max" ? "ir-hot" : "ir-cool"));
  }
  const chn = r.chennai?.N;
  if (chn) tiles.push(tile("Nungambakkam", `${t1(chn.max)} / ${t1(chn.min)}${tempUnit()}`, `Rain ${mmTxt(chn.rain24)} mm`, "ir-chn"));
  $("ir-tiles").replaceChildren(...tiles);
  const lines = [s.rainfall, s.maxTendency && `Max temperature: ${s.maxTendency}`, s.maxDeparture].filter(Boolean);
  $("ir-summary").replaceChildren(...lines.map((l) => h("p", {}, l)));
}

// ------------------------------------------------------------ Chennai

function renderChennai(r) {
  const c = r.chennai;
  const tbl = $("ir-chennai");
  if (!c) {
    tbl.replaceChildren();
    return;
  }
  const N = c.N || {};
  const A = c.AP || {};
  const u = tempUnit();
  const row = (label, a, b, cls = "") => h("tr", {}, h("th", { scope: "row" }, label), h("td", { class: cls }, a), h("td", { class: cls }, b));
  const withDep = (v, d, fmt = t1, dfmt = dt) => {
    const span = h("span", {}, fmt(v));
    return isNum(d) ? [span, " ", h("small", { class: depClass(fmt === t1 ? d : 0) }, `(${dfmt(d)})`)] : span;
  };
  const cell = (v, d, fmt, dfmt) => {
    const td = document.createDocumentFragment();
    for (const x of [].concat(withDep(v, d, fmt, dfmt))) td.append(x);
    return td;
  };
  const pct = (d) => sign(d, 0);
  const mmDep = (d) => sign(d, 1);
  const seasonFrom = c.seasonFrom ? shortDate(c.seasonFrom) : "1 Oct";
  tbl.replaceChildren(
    h("thead", {}, h("tr", {}, h("th", {}, ""), h("th", {}, "Nungambakkam"), h("th", {}, "Meenambakkam"))),
    h(
      "tbody",
      {},
      row(`Max (${u})`, cell(N.max, N.maxDep), cell(A.max, A.maxDep)),
      row(`Min (${u})`, cell(N.min, N.minDep), cell(A.min, A.minDep)),
      row(`At 8:30 AM (${u})`, t1(N.t0830), t1(A.t0830)),
      row("Humidity 8:30 AM (%)", cell(N.rh0830, N.rh0830Dep, (v) => (isNum(v) ? String(v) : "–"), pct), cell(A.rh0830, A.rh0830Dep, (v) => (isNum(v) ? String(v) : "–"), pct)),
      row("Rain, 24 h (mm)", mmTxt(N.rain24), mmTxt(A.rain24), "ir-strong"),
      row(`Rain since ${seasonFrom} (mm)`, cell(N.season, N.seasonDep, mmTxt, mmDep), cell(A.season, A.seasonDep, mmTxt, mmDep))
    )
  );
  // Departures of the season are in mm; give them as a share of normal too.
  const pctOf = (v, d) => (isNum(v) && isNum(d) && v - d > 0 ? Math.round((d / (v - d)) * 100) : null);
  const pn = pctOf(N.season, N.seasonDep);
  const pa = pctOf(A.season, A.seasonDep);
  $("ir-chennai-note").textContent =
    pn !== null
      ? `Season so far: Nungambakkam ${pn >= 0 ? pn + "% above" : -pn + "% below"} normal${pa !== null ? `, Meenambakkam ${pa >= 0 ? pa + "% above" : -pa + "% below"}` : ""}. Departures from normal in brackets.`
      : "Departures from normal in brackets.";

  const fc = r.chennaiForecast?.days || [];
  $("ir-chn-fc").replaceChildren(
    ...fc.map((d) =>
      h(
        "div",
        { class: "ir-fc-day" },
        h("strong", {}, d.date ? longDate(d.date).replace(/ \d{4}$/, "") : d.label),
        h("span", { class: "ir-fc-temp" }, h("small", {}, "Max "), rangeTxt(d.maxRange, d.max)),
        h("span", { class: "ir-fc-temp" }, h("small", {}, "Min "), rangeTxt(d.minRange, d.min)),
        h("span", {}, [d.sky, d.weather].filter(Boolean).join(" ")),
        d.rain ? h("small", {}, `24 h rain: ${d.rain}`) : null
      )
    )
  );
}

function rangeTxt(range, text) {
  if (Array.isArray(range)) return `${range.map((v) => Math.round(toTemp(v))).join("–")}${tempUnit()}`;
  return (text || "–").replace(/\.$/, "");
}

// ------------------------------------------------------------ temperatures

const SORTS = {
  max: ["Hottest first", (a, b) => (b.max ?? -99) - (a.max ?? -99)],
  min: ["Coolest nights first", (a, b) => (a.min ?? 99) - (b.min ?? 99)],
  dep: ["Most above normal first", (a, b) => (b.maxDep ?? -99) - (a.maxDep ?? -99)],
  name: ["A to Z", (a, b) => niceName(a.name).localeCompare(niceName(b.name))],
};

function renderTemps(r) {
  const rows = (r.stations || []).filter((s) => isNum(s.max) || isNum(s.min));
  rows.sort(SORTS[sortPick.value]?.[1] || SORTS.max[1]);
  const all = rows.flatMap((s) => [s.max, s.min]).filter(isNum);
  if (!all.length) {
    $("ir-temps").replaceChildren(h("p", { class: "note" }, "No temperatures in this report."));
    return;
  }
  const lo = Math.floor(Math.min(...all) / 5) * 5;
  const hi = Math.ceil(Math.max(...all) / 5) * 5;
  const x = (v) => `${((v - lo) / (hi - lo)) * 100}%`;
  const ticks = [];
  for (let v = lo; v <= hi; v += 5) ticks.push(h("span", { style: `left:${x(v)}` }, Math.round(toTemp(v))));
  $("ir-temps").replaceChildren(
    h("div", { class: "ir-db-row ir-db-axis" }, h("span", {}, ""), h("div", { class: "ir-db-ticks" }, ticks), h("span", {}, tempUnit())),
    ...rows.map((s) => {
      const track = h("div", { class: "ir-db-track" });
      if (isNum(s.max) && isNum(s.min))
        track.append(h("i", { class: "ir-db-span", style: `left:${x(s.min)};right:calc(100% - ${x(s.max)})` }));
      if (isNum(s.min)) track.append(h("b", { class: `ir-db-min ${depClass(s.minDep)}`, style: `left:${x(s.min)}` }));
      if (isNum(s.max)) track.append(h("b", { class: `ir-db-max ${depClass(s.maxDep)}`, style: `left:${x(s.max)}` }));
      return h(
        "div",
        { class: "ir-db-row" },
        h("span", { class: "ir-db-name" }, niceName(s.name)),
        track,
        h(
          "span",
          { class: "ir-db-val" },
          h("b", { class: depClass(s.maxDep) }, t1(s.max)),
          h("small", {}, " / "),
          h("b", { class: depClass(s.minDep) }, t1(s.min))
        )
      );
    })
  );
}

// ------------------------------------------------------------ rain

function hbar(name, sub, value, max, label, cls = "") {
  return h(
    "div",
    { class: `ir-hb ${cls}` },
    h("span", { class: "ir-hb-name" }, name, sub ? h("small", {}, sub) : null),
    h("span", { class: "ir-hb-track" }, h("i", { style: `width:${max > 0 ? Math.max(1.5, (value / max) * 100) : 0}%` })),
    h("b", {}, label)
  );
}

function renderRain(r) {
  // IMD's chief amounts (whole cm, every rain gauge it reads) with the exact
  // mm where an IMD station or the day's highest has it.
  const exact = new Map();
  for (const s of r.stations || []) if (isNum(s.rain) && s.rain > 0) exact.set(niceName(s.name).toLowerCase(), s.rain);
  const hr = r.summary?.highestRain;
  if (hr) exact.set(hr.place.toLowerCase(), hr.mm);
  const places = [];
  const seen = new Set();
  for (const d of r.chiefRain || []) {
    for (const p of d.places) {
      const key = niceName(p.name).toLowerCase();
      seen.add(key);
      places.push({ name: niceName(p.name), district: d.district, mm: exact.get(key) ?? p.cm * 10, exact: exact.has(key) });
    }
  }
  // IMD stations with under 1 cm are not among the chief amounts.
  for (const s of r.stations || []) {
    const key = niceName(s.name).toLowerCase();
    if (isNum(s.rain) && s.rain > 0 && !seen.has(key)) places.push({ name: niceName(s.name), district: "IMD station", mm: s.rain, exact: true });
  }
  places.sort((a, b) => b.mm - a.mm);
  const max = Math.max(1, ...places.map((p) => p.mm));
  $("ir-rain").replaceChildren(
    ...(places.length
      ? places.map((p) => hbar(p.name, p.district, p.mm, max, p.exact ? `${mmTxt(p.mm)} mm` : `${Math.round(p.mm / 10)} cm`, "wet"))
      : [h("p", { class: "note" }, "No rain of 1 cm or more was reported.")])
  );
  const light = (r.chiefRain || []).filter((d) => !d.places.length && d.note);
  const spread = (r.chiefRain || []).map((d) => `${d.district} (${SPATIAL[d.spatial] || d.spatial})`);
  $("ir-rain-note").textContent = [
    spread.length ? `Where it rained: ${spread.join(", ")}.` : "",
    light.length ? `Light rain only: ${light.map((d) => d.district).join(", ")}.` : "",
    "cm figures are IMD's whole-centimetre chief amounts; mm figures are exact.",
  ]
    .filter(Boolean)
    .join(" ");
}

function renderSeason(r) {
  const rows = (r.stations || [])
    .filter((s) => isNum(s.season))
    .map((s) => {
      const normal = isNum(s.seasonDep) ? s.season - s.seasonDep : null;
      const pct = normal > 0 ? Math.round((s.seasonDep / normal) * 100) : null;
      return { ...s, normal, pct };
    })
    .sort((a, b) => (b.pct ?? -999) - (a.pct ?? -999));
  const max = Math.max(1, ...rows.flatMap((s) => [s.season, s.normal].filter(isNum)));
  $("ir-season").replaceChildren(
    ...rows.map((s) => {
      const c = s.pct === null ? "nd" : s.pct >= 60 ? "le" : s.pct >= 20 ? "e" : s.pct > -20 ? "n" : s.pct > -60 ? "d" : s.pct > -100 ? "ld" : "nr";
      const row = hbar(niceName(s.name), s.pct === null ? "no normal" : `${s.pct > 0 ? "+" : ""}${s.pct}%`, s.season, max, `${mmTxt(s.season)} mm`, `cat-${c}`);
      if (isNum(s.normal)) row.querySelector(".ir-hb-track").append(h("u", { style: `left:${(s.normal / max) * 100}%`, title: `Normal ${mmTxt(s.normal)} mm` }));
      return row;
    })
  );
}

// ------------------------------------------------------------ districts

function renderDistricts(r) {
  const d = r.districts || { rows: [] };
  const rows = d.rows.filter((x) => !x.total && isNum(x.season.dep)).sort((a, b) => b.season.dep - a.season.dep);
  const totals = d.rows.filter((x) => x.total);
  const lim = Math.max(60, ...rows.map((x) => Math.abs(x.season.dep)));
  $("ir-dist-head").textContent = d.period
    ? `Season ${shortDate(d.period[0])} to ${shortDate(d.period[1])}: rain against normal`
    : "Season so far: rain against normal";
  $("ir-districts").replaceChildren(
    ...totals.map((x) => distRow(x, lim, true)),
    ...rows.map((x) => distRow(x, lim))
  );

  const tbody = h("tbody");
  for (const x of [...totals, ...d.rows.filter((y) => !y.total)]) {
    tbody.append(
      h(
        "tr",
        { class: x.total ? "ir-total" : "" },
        h("th", { scope: "row" }, x.name),
        h("td", {}, mmTxt(x.day.actual)),
        h("td", {}, mmTxt(x.day.normal)),
        h("td", { class: `cat-${CAT[x.day.cat] || "nd"} ir-cat` }, x.day.cat || "–"),
        h("td", {}, mmTxt(x.season.actual)),
        h("td", {}, mmTxt(x.season.normal)),
        h("td", {}, isNum(x.season.dep) ? `${x.season.dep > 0 ? "+" : ""}${x.season.dep}%` : "–"),
        h("td", { class: `cat-${CAT[x.season.cat] || "nd"} ir-cat` }, x.season.cat || "–")
      )
    );
  }
  $("ir-dist-table").replaceChildren(
    h(
      "thead",
      {},
      h("tr", {}, h("th", {}, ""), h("th", { colspan: 3 }, d.day ? `Day (${shortDate(d.day[1])})` : "Day"), h("th", { colspan: 4 }, "Season so far")),
      h("tr", {}, h("th", {}, "District"), h("th", {}, "mm"), h("th", {}, "Normal"), h("th", {}, "Cat"), h("th", {}, "mm"), h("th", {}, "Normal"), h("th", {}, "Dep."), h("th", {}, "Cat"))
    ),
    tbody
  );
}

function distRow(x, lim, total = false) {
  const p = x.season.dep;
  const w = (Math.min(Math.abs(p), lim) / lim) * 50;
  const cat = CAT[x.season.cat] || "nd";
  return h(
    "div",
    { class: `ir-div-row cat-${cat}${total ? " ir-total" : ""}`, title: `${x.name}: ${mmTxt(x.season.actual)} of ${mmTxt(x.season.normal)} mm, ${CAT_NAME[x.season.cat] || ""}` },
    h("span", { class: "ir-hb-name" }, x.name),
    h("span", { class: "ir-div-track" }, h("i", { style: p >= 0 ? `left:50%;width:${w}%` : `left:${50 - w}%;width:${w}%` })),
    h("b", {}, `${p > 0 ? "+" : ""}${p}%`)
  );
}

// ------------------------------------------------------------ stations table

function renderStationTable(r) {
  const tbody = h("tbody");
  for (const s of r.stations || []) {
    tbody.append(
      h(
        "tr",
        {},
        h("th", { scope: "row" }, niceName(s.name)),
        h("td", { class: depClass(s.maxDep) }, t1(s.max)),
        h("td", {}, dt(s.maxDep)),
        h("td", { class: depClass(s.minDep) }, t1(s.min)),
        h("td", {}, dt(s.minDep)),
        h("td", {}, isNum(s.rh) ? String(s.rh) : "–"),
        h("td", { class: s.rain > 0 ? "raining" : "" }, mmTxt(s.rain)),
        h("td", {}, mmTxt(s.season)),
        h("td", {}, isNum(s.seasonDep) ? sign(s.seasonDep) : "–"),
        h("td", {}, isNum(s.yearCm) ? String(s.yearCm) : "–"),
        h("td", {}, isNum(s.normalCm) ? String(s.normalCm) : "–"),
        h("td", { class: "muted" }, s.weather || "")
      )
    );
  }
  const u = tempUnit();
  $("ir-stations").replaceChildren(
    h(
      "thead",
      {},
      h(
        "tr",
        {},
        ...["Station", `Max ${u}`, "Dep.", `Min ${u}`, "Dep.", "RH %", "Rain mm", "Season mm", "Dep. mm", "Year cm", "Annual normal cm", "Wx"].map((t) => h("th", {}, t))
      )
    ),
    tbody
  );
}

// ------------------------------------------------------------ forecast and text

function renderForecast(r) {
  const days = r.forecast?.days || [];
  $("ir-forecast").replaceChildren(
    ...days.map((d) =>
      h(
        "li",
        { class: `ir-fc-row ${rainLevel(d.text.join(" "))}` },
        h("strong", {}, d.days.length > 1 ? `Days ${d.days.join(" & ")}` : `Day ${d.days[0]}`, h("small", {}, d.dates.filter(Boolean).map(shortDate).join(", "))),
        h("div", {}, ...d.text.map((t) => h("p", {}, t)))
      )
    )
  );
  $("ir-maxfc").textContent = r.forecast?.maxTemp || "";
  $("ir-synoptic").replaceChildren(...(r.synoptic || []).map((p) => h("li", {}, p)));

  const tables = r.temperatureTables || {};
  const names = { maxChange: "Max temperature, change in 24 hours", maxDeparture: "Max temperature against normal", minChange: "Min temperature, change in 24 hours", minDeparture: "Min temperature against normal" };
  $("ir-changes").replaceChildren(
    ...Object.entries(names)
      .filter(([k]) => tables[k]?.length)
      .map(([k, title]) =>
        h(
          "div",
          { class: "ir-change" },
          h("strong", {}, title),
          h("ul", {}, ...tables[k].map((x) => h("li", {}, h("span", {}, tidyBand(x.label)), " ", x.where)))
        )
      )
  );
}

// IMD's band labels lose their degree signs in the PDF ("4.0 o").
const tidyBand = (s) =>
  String(s)
    .replace(/(\d)\s*o\s*(?=C|\)|$|\s)/g, "$1°")
    .replace(/°\s*°/g, "°")
    .replace(/\s*°\s*C/g, "°C")
    .replace(/\(\s*/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/(\w)\(/, "$1 (");

function rainLevel(text) {
  if (/extremely heavy/i.test(text)) return "lvl-xh";
  if (/very heavy/i.test(text)) return "lvl-vh";
  if (/heavy/i.test(text)) return "lvl-h";
  if (/moderate/i.test(text)) return "lvl-m";
  if (/light/i.test(text)) return "lvl-l";
  return "lvl-dry";
}

// ------------------------------------------------------------ maps

function renderMaps(r) {
  const box = $("ir-maps");
  const isLatest = latest && r.date === latest.date;
  if (!r.maps?.length || !isLatest) {
    box.replaceChildren(h("p", { class: "note" }, r.maps?.length ? "Maps are kept for the latest report only." : "No maps in this report."));
    return;
  }
  box.replaceChildren(
    ...r.maps.map((m) => {
      const det = h("details", { class: "ir-map" }, h("summary", {}, m.title));
      det.addEventListener(
        "toggle",
        () => {
          if (!det.open || det.querySelector("img")) return;
          const img = h("img", { alt: `${m.title}, from IMD's daily report of ${longDate(r.date)}`, crossorigin: "anonymous", width: m.width, height: m.height });
          img.src = `${DATA}${m.src}?d=${r.date}`;
          det.append(h("div", { "data-share": `IMD daily report · ${m.title}`, "data-share-imd": "" }, img));
          initSnaps(det);
      });
      return det;
    })
  );
}

// ------------------------------------------------------------ history

const WHAT = {
  temp: "Max and min temperature",
  rain: "Rain, 24 hours",
  season: "Rain this season",
};

function renderHistory() {
  const days = history?.days || [];
  const note = $("ir-hist-note");
  const svg = $("ir-hist-chart");
  const readout = $("ir-hist-readout");
  if (!days.length) {
    svg.replaceChildren();
    readout.textContent = "";
    note.textContent = "The history starts with the first report read.";
    return;
  }
  // Station list from the newest day, Chennai first.
  const names = Object.keys(days[days.length - 1].stations || {});
  if (histStation.options.length !== names.length) {
    const keep = histStation.value || "Chennai";
    names.sort((a, b) => (a === "Chennai" ? -1 : b === "Chennai" ? 1 : niceName(a).localeCompare(niceName(b))));
    histStation.replaceChildren(...names.map((n) => new Option(n === "Chennai" ? "Chennai (Nungambakkam)" : niceName(n), n)));
    histStation.value = names.includes(keep) ? keep : names[0];
  }
  const st = histStation.value;
  const what = histWhat.value;
  const vals = days.map((d) => d.stations?.[st] || []);
  const count = days.length;
  const step = Math.max(1, Math.ceil(count / 6));
  const ticks = days.map((d, i) => (i % step === 0 || (i === count - 1 && i % step >= step / 2) ? { at: i, label: shortDate(d.date) } : null)).filter(Boolean);
  note.textContent =
    count < 2
      ? `The history starts on ${longDate(days[0].date)} and grows by a day with every report.`
      : `${count} reports, ${shortDate(days[0].date)} to ${shortDate(days[count - 1].date)}.`;
  if (what === "temp") {
    const max = vals.map((v) => (isNum(v[0]) ? toTemp(v[0]) : null));
    const min = vals.map((v) => (isNum(v[1]) ? toTemp(v[1]) : null));
    const all = [...max, ...min].filter(isNum);
    // Four equal steps of a whole number of degrees.
    const lo = all.length ? Math.floor(Math.min(...all)) - 1 : 0;
    const hi = lo + (all.length ? Math.ceil((Math.max(...all) + 1 - lo) / 4) * 4 : 40);
    drawLines(
      svg,
      readout,
      {
        count: Math.max(count, 2),
        series: [
          { values: max, cls: "ir-max" },
          { values: min, cls: "ir-min" },
        ],
        ticks,
        marks: days.flatMap((d, i) => [
          ...(isNum(max[i]) ? [{ at: i, value: max[i], cls: "ir-max" }] : []),
          ...(isNum(min[i]) ? [{ at: i, value: min[i], cls: "ir-min" }] : []),
        ]),
      },
      `Latest: max ${t1(vals[count - 1][0])}, min ${t1(vals[count - 1][1])}${tempUnit()}.`,
      { unit: tempUnit(), min: lo, max: hi }
    );
  } else {
    const k = what === "rain" ? 2 : 3;
    drawBars(
      svg,
      readout,
      days.map((d, i) => ({
        tick: ticks.find((t) => t.at === i)?.label || "",
        value: isNum(vals[i][k]) ? vals[i][k] : null,
        text: `${longDate(d.date)}: ${mmTxt(vals[i][k])} mm`,
        cls: "wet",
      })),
      "Tap a bar for its day.",
      { unit: "mm" }
    );
  }
}

// ------------------------------------------------------------ loading

// Today's date and the time of day in India, whatever the phone's time zone.
function indiaNow() {
  const d = new Date(Date.now() + 5.5 * 3600 * 1000);
  return { date: d.toISOString().slice(0, 10), hour: d.getUTCHours() + d.getUTCMinutes() / 60 };
}

// A note when the newest report published is not today's. The workflow
// reads the PDF at 2:15, 4:15 and 7 PM IST; IMD's file usually changes
// around 3:45 PM.
function renderStale(r) {
  const note = $("ir-stale");
  const now = indiaNow();
  const isLatest = latest && r.date === latest.date;
  if (!isLatest || !r.date || r.date >= now.date) {
    note.hidden = true;
    return;
  }
  note.textContent =
    now.hour < 19.5
      ? `Not updated today yet. IMD issues the report in the afternoon and the app usually has it by about 4:30 PM (7 PM at the latest). Showing ${longDate(r.date)}.`
      : `Today's report hasn't come in. IMD may be late or the report may not be out today. Showing ${longDate(r.date)}.`;
  note.hidden = false;
}

function render(r) {
  shownReport = r;
  $("ir-body").hidden = false;
  renderStale(r);
  renderHighlights(r);
  renderChennai(r);
  renderTemps(r);
  renderRain(r);
  renderSeason(r);
  renderDistricts(r);
  renderStationTable(r);
  renderForecast(r);
  renderMaps(r);
}

function fillDates() {
  const dates = new Set((history?.days || []).map((d) => d.date));
  if (latest) dates.add(latest.date);
  const list = [...dates].sort().reverse();
  const keep = datePick.value;
  datePick.replaceChildren(...list.map((d, i) => new Option(longDate(d), d)));
  datePick.value = list.includes(keep) ? keep : list[0] || "";
}

function loadSaved() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVED_KEY));
    return s?.report ? s : null;
  } catch {
    return null;
  }
}

async function refresh(force = false) {
  if (!latest) {
    const saved = loadSaved();
    if (saved) {
      latest = saved.report;
      history = saved.history || history;
      byDate.set(latest.date, latest);
      fillDates();
      render(latest);
      renderHistory();
    }
  }
  if (!force && Date.now() - loadedAt < TTL) return;
  say("Loading IMD's daily report…");
  try {
    const [rep, hist] = await Promise.all([getJson("latest.json"), getJson("history.json").catch(() => null)]);
    const wasLatest = !datePick.value || datePick.value === latest?.date;
    latest = rep;
    if (hist) history = hist;
    byDate.set(rep.date, rep);
    loadedAt = Date.now();
    fillDates();
    if (wasLatest) datePick.value = rep.date;
    render(byDate.get(datePick.value) || rep);
    renderHistory();
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify({ at: loadedAt, report: rep, history }));
    } catch {}
    say(`Report of ${longDate(rep.date)}. Checked ${new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}.`);
  } catch (e) {
    const saved = loadSaved();
    say(
      saved
        ? `Couldn't reach the report (${e.message}). Showing the copy saved ${when(saved.at)}.`
        : `Couldn't load the daily report (${e.message}). The full PDF is linked below.`,
      true
    );
  }
}

async function showDate(date) {
  if (byDate.has(date)) return render(byDate.get(date));
  say(`Loading the report of ${longDate(date)}…`);
  try {
    const r = await getJson(`${date}.json`);
    byDate.set(date, r);
    if (datePick.value === date) render(r);
    say(`Report of ${longDate(date)}.`);
  } catch (e) {
    say(`Couldn't load the report of ${longDate(date)} (${e.message}).`, true);
  }
}

export function initImdReport() {
  sortPick.replaceChildren(...Object.entries(SORTS).map(([k, [label]]) => new Option(label, k)));
  sortPick.addEventListener("change", () => shownReport && renderTemps(shownReport));
  histWhat.replaceChildren(...Object.entries(WHAT).map(([k, v]) => new Option(v, k)));
  histStation.addEventListener("change", renderHistory);
  histWhat.addEventListener("change", renderHistory);
  datePick.addEventListener("change", () => showDate(datePick.value));
  $("ir-refresh").addEventListener("click", () => refresh(true));
  $("ir-pdf").href = PDF;
}

export function showImdReport() {
  refresh();
}
