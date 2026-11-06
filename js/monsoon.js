// Monsoon (#monsoon): IMD's rainfall against normal for Chennai, the nearby
// districts, Tamil Nadu and the Tamil Nadu–Puducherry subdivision. The
// northeast monsoon season counts from 1 October, which is IMD's "cumulative"
// figure from October to December. Daily, weekly and monthly figures are
// there too.
//
// The numbers are read from IMD's rainfall pages (district, state and
// subdivision maps), which carry them for every area in the map data. The
// pages send no CORS header; the Android app adds it. The last figures are
// kept on the phone.
import { when } from "./offline.js";

const BASE = "https://mausam.imd.gov.in/responsive/";
const PAGES = {
  district: "rainfallinformation.php",
  state: "rainfallinformation_state.php",
  subdivision: "rainfallinformation_msd.php",
};
const SAVED_KEY = "myweather.monsoon.";
const TTL = 30 * 60 * 1000;

// IMD's district names for Tamil Nadu and Puducherry (as spelt on its pages).
const TN_DISTRICTS = [
  "ARIYALUR", "CHENGALPATTU", "CHENNAI", "COIMBATORE", "CUDDALORE", "DHARMAPURI", "DINDIGUL", "ERODE",
  "KALLAKKURICHI", "KANCHEEPURAM", "KANYAKUMARI", "KARUR", "KRISHNAGIRI", "MADURAI", "MAYILADUTHURAI",
  "NAGAPATTINAM", "NAMAKKAL", "NILGIRIS", "PERAMBALUR", "PUDUKKOTTAI", "RAMANATHAPURAM", "RANIPET", "SALEM",
  "SIVAGANGAI", "TENKASI", "THANJAVUR", "THENI", "THIRUCHIRAPPALLI", "THIRUNELVELI", "THIRUPPUR",
  "THIRUVALLUR", "THIRUVANNAMALAI", "THIRUVARUR", "TIRUPATTUR", "TUTICORIN", "VELLORE", "VILLUPURAM",
  "VIRUDHUNAGAR", "PUDUCHERRY", "KARAIKAL",
];
const CHENNAI_AREA = ["CHENNAI", "THIRUVALLUR", "CHENGALPATTU", "KANCHEEPURAM"];

const PERIODS = {
  C: "Season so far",
  M: "This month",
  W: "Last 7 days",
  D: "Yesterday",
};

const LABEL = { C: "cumulative", M: "monthly", W: "weekly", D: "daily" };

const $ = (id) => document.getElementById(id);
const status = $("mon-status");
const periodPick = $("mon-period");

const loadedAt = {};

function say(text, error = false) {
  status.textContent = text;
  status.className = error ? "status error" : "status";
}

const title = (s) =>
  s
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace(/\bTn\b/, "TN")
    .replace(/\(ut\)/i, "(UT)");

// Every area's figures on an IMD rainfall page:
// { NAME: { actual, normal, departure } }, plus the period label and date.
export function parseRainfallPage(html) {
  const areas = {};
  const re = /"balloonText"\s*:\s*"<h6>([^<]*?)\s*<\\?\/h6>([^"]*)"/g;
  let m;
  let date = "";
  while ((m = re.exec(html))) {
    const name = m[1].replace(/\s+/g, " ").trim().toUpperCase();
    const body = m[2];
    const actual = body.match(/Actual\s*:\s*(-?[\d.]+)/i);
    const normal = body.match(/Normal\s*:\s*(-?[\d.]+)/i);
    const dep = body.match(/Departure\s*:\s*(-?[\d.]+|NA|N\.A\.)\s*%?/i);
    const d = body.match(/Date\s*:\s*(\d{4}-\d{2}-\d{2})/);
    if (d && d[1] > date) date = d[1];
    if (!actual && !normal) continue;
    const a = actual ? Number(actual[1]) : null;
    const n = normal ? Number(normal[1]) : null;
    let p = dep && /^-?[\d.]+$/.test(dep[1]) ? Number(dep[1]) : null;
    if (p === null && a !== null && n > 0) p = Math.round(((a - n) / n) * 100);
    areas[name] = { actual: a, normal: n, departure: p };
  }
  // The checked option's label, e.g. "Cumulative (From 01-10-2026)".
  const labels = {};
  for (const l of html.matchAll(/<label[^>]*for="rb\d"[^>]*>([^<]+)<\/label>/g)) {
    const t = l[1].replace(/,+/g, " ").replace(/\s+/g, " ").replace(/\(\s+/, "(").replace(/\s+\)/, ")").trim();
    labels[t.split(" ")[0].toLowerCase()] = t;
  }
  const recorded = html.match(/Rainfall Recorded[^<]*/i)?.[0].trim() || "";
  return { areas, date, labels, recorded };
}

// IMD's categories by departure from normal.
export function category(p) {
  if (p === null || p === undefined) return { name: "No data", cls: "nd" };
  if (p <= -100) return { name: "No rain", cls: "nr" };
  if (p <= -60) return { name: "Large deficient", cls: "ld" };
  if (p <= -20) return { name: "Deficient", cls: "d" };
  if (p < 20) return { name: "Normal", cls: "n" };
  if (p < 60) return { name: "Excess", cls: "e" };
  return { name: "Large excess", cls: "le" };
}

const mm = (v) => (typeof v !== "number" ? "–" : v < 10 ? v.toFixed(1) : String(Math.round(v)));
const pct = (p) => (p === null || p === undefined ? "–" : `${p > 0 ? "+" : ""}${p}%`);

async function getPage(page, period) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 40000);
  try {
    const res = await fetch(`${BASE}${page}?msg=${period}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseRainfallPage(await res.text());
  } finally {
    clearTimeout(timer);
  }
}

function card(label, a, sub) {
  const li = document.createElement("li");
  const c = category(a?.departure);
  li.className = `mon-card cat-${c.cls}`;
  const max = Math.max(a?.actual || 0, a?.normal || 0, 1);
  li.innerHTML = `
    <div class="mon-head"><strong></strong><span class="mon-dep"></span></div>
    <div class="mon-bars">
      <span>Actual</span><span class="meter"><span class="actual"></span></span><b></b>
      <span>Normal</span><span class="meter"><span class="normal"></span></span><b></b>
    </div>
    <small></small>`;
  li.querySelector("strong").textContent = label;
  li.querySelector(".mon-dep").textContent = a ? `${pct(a.departure)} · ${c.name}` : "No data";
  const [actual, normal] = li.querySelectorAll(".mon-bars b");
  actual.textContent = a ? `${mm(a.actual)} mm` : "–";
  normal.textContent = a ? `${mm(a.normal)} mm` : "–";
  li.querySelector(".actual").style.width = `${((a?.actual || 0) / max) * 100}%`;
  li.querySelector(".normal").style.width = `${((a?.normal || 0) / max) * 100}%`;
  li.querySelector("small").textContent = sub || "";
  return li;
}

function districtRow(name, a) {
  const li = document.createElement("li");
  const c = category(a?.departure);
  li.className = `cat-${c.cls}`;
  li.innerHTML = `<span></span><b></b><small></small>`;
  li.querySelector("span").textContent = title(name);
  li.querySelector("b").textContent = pct(a?.departure);
  li.querySelector("small").textContent = a ? `${mm(a.actual)} of ${mm(a.normal)} mm · ${c.name}` : "No data";
  return li;
}

function render(data, period) {
  const { district, state, subdivision } = data;
  const label =
    state.labels[LABEL[period]] || district.labels[LABEL[period]] || PERIODS[period];
  $("mon-heading").textContent =
    `${label}${district.date && !/\bTo\b/.test(label) ? ` · up to ${district.date.split("-").reverse().join("-")}` : ""}. ` +
    (period === "C" ? "The northeast monsoon season runs from 1 October to 31 December." : "");

  const sub = Object.entries(subdivision.areas).find(([k]) => /^TN\b|TAMIL/.test(k))?.[1];
  const tn = Object.entries(state.areas).find(([k]) => k.startsWith("TAMIL NADU"))?.[1];
  const pdy = Object.entries(state.areas).find(([k]) => k.startsWith("PUDUCHERRY"))?.[1];
  $("mon-cards").replaceChildren(
    card("Chennai", district.areas.CHENNAI, "Chennai district"),
    card("Tamil Nadu", tn, "State average"),
    card("Tamil Nadu, Puducherry & Karaikal", sub, "IMD subdivision"),
    ...(pdy ? [card("Puducherry (UT)", pdy, "")] : [])
  );

  $("mon-near").replaceChildren(...CHENNAI_AREA.map((n) => districtRow(n, district.areas[n])));
  const all = TN_DISTRICTS.map((n) => [n, district.areas[n]]).sort(
    (x, y) => (y[1]?.departure ?? -1e9) - (x[1]?.departure ?? -1e9)
  );
  $("mon-districts").replaceChildren(...all.map(([n, a]) => districtRow(n, a)));
}

function loadSaved(period) {
  try {
    const s = JSON.parse(localStorage.getItem(SAVED_KEY + period));
    return s && s.at && s.data ? s : null;
  } catch {
    return null;
  }
}

async function refresh(force = false) {
  const period = periodPick.value;
  const saved = loadSaved(period);
  if (saved) render(saved.data, period);
  if (!force && Date.now() - (loadedAt[period] || 0) < TTL) return;
  say("Loading IMD rainfall figures…");
  try {
    const [district, state, subdivision] = await Promise.all(
      Object.values(PAGES).map((p) => getPage(p, period))
    );
    if (!Object.keys(district.areas).length) throw new Error("no figures on IMD's page");
    const data = { district, state, subdivision };
    if (periodPick.value !== period) return;
    render(data, period);
    loadedAt[period] = Date.now();
    try {
      localStorage.setItem(SAVED_KEY + period, JSON.stringify({ at: loadedAt[period], data }));
    } catch {}
    say(`Updated ${new Date().toLocaleTimeString()}${district.recorded ? ` · ${district.recorded}` : ""}`);
  } catch (e) {
    if (periodPick.value !== period) return;
    say(
      saved
        ? `Couldn't reach IMD. Showing figures saved at ${when(saved.at)}.`
        : `Couldn't load IMD's rainfall figures (${e.message}). Try Refresh.`,
      true
    );
  }
}

export function initMonsoon() {
  periodPick.replaceChildren(...Object.entries(PERIODS).map(([k, v]) => new Option(v, k)));
  periodPick.addEventListener("change", () => refresh());
  $("mon-refresh").addEventListener("click", () => refresh(true));
}

export function showMonsoon() {
  refresh();
}
