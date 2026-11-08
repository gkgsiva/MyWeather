// Year on year (#yoy): this northeast monsoon's rain (from 1 October) against
// the same days of past seasons, for Chennai and every Tamil Nadu district.
//
// Rain gauges don't go back far enough in a form the app can read (TN-SMART's
// files start in 2025), so every season comes from one source: Open-Meteo's
// archive of ERA5, the European weather reanalysis, at each district's middle
// (one point, about 25 km across). The same source every year makes the years
// comparable; the amounts are a model's, and it tends to miss the heaviest
// downpours, so IMD's measured figure for this season is shown alongside when
// the Monsoon screen has loaded it. The archive runs about 5 days behind; the
// last days of this season are filled from Open-Meteo's forecast service.
//
// Past seasons never change, so they are kept on the phone after the first
// download (one small request a season).
import { drawLines, drawBars } from "./chart.js";
import { when } from "./offline.js";
import { seasonByDistrict } from "./monsoon.js";
import { matchDistrict } from "./prefs.js";

const ARCHIVE = "https://archive-api.open-meteo.com/v1/archive";
const FORECAST = "https://api.open-meteo.com/v1/forecast";
const SAVED_KEY = "myweather.yoy.season."; // + year: { at, rain: [[mm per day] per area] }
const AREA_KEY = "myweather.yoy.area";
const FIRST = 2000; // the first season shown (ERA5 goes back much further)
const TTL = 60 * 60 * 1000;

// [IMD's name, shown name, lat, lon]: the middle of each district (from
// TN-SMART's district outlines); Chennai at Nungambakkam.
export const AREAS = [
  ["CHENNAI", "Chennai", 13.067, 80.248],
  ["ARIYALUR", "Ariyalur", 11.162, 79.244],
  ["CHENGALPATTU", "Chengalpattu", 12.572, 79.997],
  ["COIMBATORE", "Coimbatore", 10.878, 76.977],
  ["CUDDALORE", "Cuddalore", 11.536, 79.45],
  ["DHARMAPURI", "Dharmapuri", 12.1, 78.193],
  ["DINDIGUL", "Dindigul", 10.392, 77.82],
  ["ERODE", "Erode", 11.518, 77.413],
  ["KALLAKKURICHI", "Kallakurichi", 11.797, 79.007],
  ["KANCHEEPURAM", "Kancheepuram", 12.833, 79.838],
  ["KANYAKUMARI", "Kanniyakumari", 8.308, 77.36],
  ["KARUR", "Karur", 10.844, 78.134],
  ["KRISHNAGIRI", "Krishnagiri", 12.491, 78.031],
  ["MADURAI", "Madurai", 9.923, 78.006],
  ["MAYILADUTHURAI", "Mayiladuthurai", 11.153, 79.71],
  ["NAGAPATTINAM", "Nagapattinam", 10.574, 79.762],
  ["NAMAKKAL", "Namakkal", 11.319, 78.136],
  ["NILGIRIS", "Nilgiris", 11.457, 76.64],
  ["PERAMBALUR", "Perambalur", 11.275, 78.892],
  ["PUDUKKOTTAI", "Pudukkottai", 10.36, 78.879],
  ["RAMANATHAPURAM", "Ramanathapuram", 9.438, 78.686],
  ["RANIPET", "Ranipet", 12.95, 79.462],
  ["SALEM", "Salem", 11.677, 78.222],
  ["SIVAGANGAI", "Sivagangai", 9.915, 78.596],
  ["TENKASI", "Tenkasi", 9.082, 77.446],
  ["THANJAVUR", "Thanjavur", 10.67, 79.241],
  ["THENI", "Theni", 9.892, 77.439],
  ["THIRUCHIRAPPALLI", "Tiruchirappalli", 10.89, 78.57],
  ["THIRUNELVELI", "Tirunelveli", 8.58, 77.602],
  ["THIRUPPUR", "Tiruppur", 10.839, 77.408],
  ["THIRUVALLUR", "Tiruvallur", 13.244, 79.933],
  ["THIRUVANNAMALAI", "Tiruvannamalai", 12.432, 79.166],
  ["THIRUVARUR", "Thiruvarur", 10.675, 79.534],
  ["TIRUPATTUR", "Tirupathur", 12.583, 78.643],
  ["TUTICORIN", "Thoothukudi", 8.903, 77.998],
  ["VELLORE", "Vellore", 12.903, 78.958],
  ["VILLUPURAM", "Villupuram", 12.116, 79.527],
  ["VIRUDHUNAGAR", "Virudhunagar", 9.493, 77.905],
];
const TN = "TN"; // the average of all districts

const $ = (id) => document.getElementById(id);
const status = $("yoy-status");
const areaPick = $("yoy-area");

let seasons = null; // { year: [[mm/day] per area] }
let current = 0; // this season's year
let toDay = 0; // days of the season so far (1 Oct = 1)
let loadedAt = 0;
let busy = false;
let imd = null; // IMD's district page for the season so far, with { at }

// ---- Dates (IST) ----

const pad = (n) => String(n).padStart(2, "0");
const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000);
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const SEASON_DAYS = 92; // 1 Oct to 31 Dec
const dayOf = (year, i) => {
  const d = new Date(Date.UTC(year, 9, 1 + i));
  return d;
};
const nice = (d) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

/** The season shown: { year, days so far (complete days, 0..92) }. */
export function seasonNow(now = istToday()) {
  const y = now.getUTCFullYear();
  if (now.getUTCMonth() < 9) return { year: y - 1, days: SEASON_DAYS };
  const start = Date.UTC(y, 9, 1);
  const days = Math.floor((Date.UTC(y, now.getUTCMonth(), now.getUTCDate()) - start) / 86400000); // up to yesterday
  return { year: y, days: Math.max(0, Math.min(SEASON_DAYS, days)) };
}

// ---- Data ----

const coords = () => ({
  latitude: AREAS.map((a) => a[2]).join(","),
  longitude: AREAS.map((a) => a[3]).join(","),
});

async function getJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 40000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.error) throw new Error(data?.reason || `HTTP ${res.status}`);
    // One place comes back as an object, several as a list.
    return Array.isArray(data) ? data : [data];
  } finally {
    clearTimeout(timer);
  }
}

// Rain per day for each area, start..end (ISO dates), with nulls where missing.
async function archive(start, end) {
  const q = new URLSearchParams({ ...coords(), start_date: start, end_date: end, daily: "precipitation_sum", timezone: "Asia/Kolkata" });
  const list = await getJson(`${ARCHIVE}?${q}`);
  return list.map((p) => (p.daily?.precipitation_sum || []).map((v) => (typeof v === "number" ? Math.round(v * 10) / 10 : null)));
}

// The last `days` days from the forecast service (before today), for the archive's gap.
async function recent(days) {
  const q = new URLSearchParams({ ...coords(), past_days: String(days), forecast_days: "1", daily: "precipitation_sum", timezone: "Asia/Kolkata" });
  const list = await getJson(`${FORECAST}?${q}`);
  return list.map((p) => ({
    time: p.daily?.time || [],
    rain: (p.daily?.precipitation_sum || []).map((v) => (typeof v === "number" ? Math.round(v * 10) / 10 : null)),
  }));
}

const readSaved = (year) => {
  try {
    const s = JSON.parse(localStorage.getItem(SAVED_KEY + year));
    return s && Array.isArray(s.rain) && s.rain.length === AREAS.length ? s : null;
  } catch {
    return null;
  }
};
const writeSaved = (year, rain) => {
  try {
    localStorage.setItem(SAVED_KEY + year, JSON.stringify({ at: Date.now(), rain }));
  } catch {}
};

async function loadSeason(year, force) {
  const { year: now, days } = seasonNow();
  const running = year === now && days < SEASON_DAYS;
  const saved = readSaved(year);
  if (saved && (!running || (!force && Date.now() - saved.at < TTL))) return saved.rain;
  const start = iso(dayOf(year, 0));
  if (!running) {
    const rain = await archive(start, iso(dayOf(year, SEASON_DAYS - 1)));
    // Keep a past season only when it's whole.
    if (rain.every((r) => r.length === SEASON_DAYS && r.every((v) => v !== null))) writeSaved(year, rain);
    return rain;
  }
  if (days === 0) return AREAS.map(() => []);
  const end = iso(dayOf(year, days - 1));
  const rain = await archive(start, end).catch(() => AREAS.map(() => Array(days).fill(null)));
  // Fill the archive's last days (and any gap) from the forecast service.
  const gapFrom = Math.min(...rain.map((r) => {
    const i = r.findIndex((v) => v === null);
    return i < 0 ? r.length : i;
  }));
  if (gapFrom < days) {
    const fill = await recent(Math.min(92, days - gapFrom + 1));
    fill.forEach((f, a) => {
      f.time.forEach((t, k) => {
        const i = Math.round((Date.parse(`${t}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);
        if (i >= 0 && i < days && rain[a][i] == null) rain[a][i] = f.rain[k];
      });
    });
  }
  for (const r of rain) r.length = days;
  writeSaved(year, rain);
  return rain;
}

// ---- Sums ----

const sum = (arr, n = arr.length) => {
  let s = 0;
  for (let i = 0; i < n; i++) if (typeof arr[i] === "number") s += arr[i];
  return s;
};
const cumulative = (arr, n) => {
  const out = [];
  let s = 0;
  for (let i = 0; i < n; i++) {
    s += typeof arr[i] === "number" ? arr[i] : 0;
    out.push(Math.round(s * 10) / 10);
  }
  return out;
};

// Daily rain of an area (index) or of Tamil Nadu (the districts' average).
function areaRain(rain, area) {
  if (area !== TN) return rain[area] || [];
  const n = Math.max(...rain.map((r) => r.length));
  return Array.from({ length: n }, (_, i) => {
    const v = rain.slice(1).map((r) => r[i]).filter((x) => typeof x === "number");
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  });
}

/** For one area: this season and every past season, to the same day. */
export function compare(all, current, days, area) {
  const years = Object.keys(all).map(Number).sort((a, b) => a - b);
  const rows = years.map((y) => {
    const r = areaRain(all[y], area);
    return { year: y, toDate: sum(r, days), whole: r.length >= SEASON_DAYS ? sum(r, SEASON_DAYS) : null, daily: r };
  });
  const past = rows.filter((r) => r.year !== current);
  const now = rows.find((r) => r.year === current);
  const avg = past.length ? past.reduce((a, r) => a + r.toDate, 0) / past.length : null;
  const avgWhole = past.length ? past.reduce((a, r) => a + (r.whole || 0), 0) / past.length : null;
  const rank = now ? [...rows].sort((a, b) => b.toDate - a.toDate).findIndex((r) => r.year === current) + 1 : null;
  const dep = now && avg > 0 ? Math.round(((now.toDate - avg) / avg) * 100) : null;
  return { rows, past, now, avg, avgWhole, rank, dep, count: rows.length };
}

// ---- Drawing ----

const mm = (v) => (typeof v !== "number" ? "–" : v < 10 ? v.toFixed(1) : String(Math.round(v)));
const pct = (p) => (p === null ? "–" : `${p > 0 ? "+" : ""}${p}%`);
const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`;
const areaIndex = () => (areaPick.value === TN ? TN : Number(areaPick.value));
const areaName = () => (areaPick.value === TN ? "Tamil Nadu" : AREAS[Number(areaPick.value)][1]);

function imdFigure(area) {
  if (area === TN) return null;
  if (imd?.areas?.[AREAS[area][0]] && seasonNow().year === current && toDay < SEASON_DAYS) {
    const a = imd.areas[AREAS[area][0]];
    if (typeof a.actual === "number") return { ...a, at: imd.at };
  }
  if (seasonNow().year !== new Date().getFullYear()) return null; // the off-season shows last season
  try {
    const s = JSON.parse(localStorage.getItem("myweather.monsoon.C"));
    const a = s?.data?.district?.areas?.[AREAS[area][0]];
    return a && typeof a.actual === "number" ? { ...a, at: s.at } : null;
  } catch {
    return null;
  }
}

function drawSummary(c, area) {
  const box = $("yoy-summary");
  const upTo = toDay ? nice(dayOf(current, toDay - 1)) : "";
  if (!c.now || !toDay) {
    box.textContent = "The season starts on 1 October.";
    return;
  }
  const word = c.dep === null ? "" : c.dep >= 0 ? `${c.dep}% more than` : `${-c.dep}% less than`;
  box.innerHTML = `<p class="yoy-big"><b></b> <span></span></p><p class="yoy-line"></p><p class="yoy-imd note"></p>`;
  box.querySelector("b").textContent = `${mm(c.now.toDate)} mm`;
  box.querySelector(".yoy-big span").textContent = `since 1 Oct, to ${upTo}`;
  box.querySelector(".yoy-line").textContent =
    `${word ? `${word} the ${c.past.length}-season average (${mm(c.avg)} mm) for the same days` : ""}` +
    ` · ${ordinal(c.rank)} wettest of the last ${c.count} seasons so far.`;
  const imd = imdFigure(area);
  box.querySelector(".yoy-imd").textContent = imd
    ? `IMD measured ${mm(imd.actual)} mm since 1 Oct (normal ${mm(imd.normal)} mm, ${pct(imd.departure)}), from the Monsoon screen, ${when(imd.at)}.`
    : area === TN
      ? "Tamil Nadu is the average of the 38 districts' points."
      : toDay < SEASON_DAYS
        ? "IMD's measured figure shows here when its page can be reached (in the app)."
        : "";
}

function drawCumulative(c) {
  const n = SEASON_DAYS;
  const series = c.past.map((r) => ({ values: cumulative(r.daily, Math.min(n, r.daily.length)), cls: "past" }));
  const avg = Array.from({ length: n }, (_, i) => {
    const v = c.past.map((r) => sum(r.daily, i + 1));
    return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
  });
  series.push({ values: avg, cls: "avg" });
  const mine = c.now ? cumulative(c.now.daily, toDay) : [];
  series.push({ values: mine, cls: "this-year" });
  const wettest = [...c.past].sort((a, b) => (b.whole || 0) - (a.whole || 0))[0];
  drawLines(
    $("yoy-chart"),
    $("yoy-readout"),
    {
      count: n,
      series,
      ticks: [
        { at: 0, label: "1 Oct" },
        { at: 31, label: "1 Nov" },
        { at: 61, label: "1 Dec" },
      ],
      points: Array.from({ length: n }, (_, i) => {
        const day = nice(dayOf(current, i));
        const by = c.past.map((r) => ({ y: r.year, v: sum(r.daily, i + 1) })).sort((a, b) => b.v - a.v);
        return {
          at: i,
          text:
            `To ${day}: ` +
            (i < toDay ? `this season ${mm(mine[i])} mm · ` : "") +
            `average ${mm(avg[i])} mm` +
            (by[0] ? ` · wettest ${by[0].y} (${mm(by[0].v)} mm), driest ${by[by.length - 1].y} (${mm(by[by.length - 1].v)} mm)` : ""),
        };
      }),
      marks: mine.length ? [{ at: mine.length - 1, value: mine[mine.length - 1], label: mm(mine[mine.length - 1]), cls: "this-year" }] : [],
    },
    wettest ? `Grey lines are past seasons; the wettest whole season was ${wettest.year} (${mm(wettest.whole)} mm). Tap any day.` : "Tap any day.",
    { unit: "mm", now: toDay && toDay < n ? toDay - 1 : undefined }
  );
}

function drawYears(c) {
  const upTo = toDay ? nice(dayOf(current, toDay - 1)) : "31 Dec";
  drawBars(
    $("yoy-bars"),
    $("yoy-bars-readout"),
    c.rows.map((r) => ({
      tick: r.year % 5 === 0 || r.year === current ? `'${String(r.year).slice(2)}` : "",
      value: r.toDate,
      cls: r.year === current ? "this" : "",
      text:
        `${r.year}: ${mm(r.toDate)} mm by ${upTo}` + (r.whole !== null && r.year !== current ? ` · ${mm(r.whole)} mm in the whole season` : ""),
    })),
    `Rain from 1 Oct to ${upTo} each season. Wettest whole seasons: ` +
      [...c.past]
        .filter((r) => r.whole !== null)
        .sort((a, b) => b.whole - a.whole)
        .slice(0, 3)
        .map((r) => `${r.year} (${mm(r.whole)} mm)`)
        .join(", ") +
      ". Tap a bar.",
    { peak: (v) => mm(v) }
  );
}

function drawTable() {
  const body = $("yoy-table").tBodies[0];
  const rows = AREAS.map((a, i) => ({ i, name: a[1], c: compare(seasons, current, toDay, i) })).sort((x, y) => (y.c.dep ?? -1e9) - (x.c.dep ?? -1e9));
  body.replaceChildren(
    ...rows.map(({ i, name, c }) => {
      const tr = document.createElement("tr");
      const cells = [name, mm(c.now?.toDate), mm(c.avg), pct(c.dep), c.rank ? `${c.rank} of ${c.count}` : "–"];
      cells.forEach((t, k) => {
        const td = document.createElement(k ? "td" : "th");
        if (!k) td.scope = "row";
        td.textContent = t;
        if (k === 3 && c.dep !== null) td.className = c.dep >= 20 ? "up" : c.dep <= -20 ? "down" : "";
        tr.append(td);
      });
      tr.addEventListener("click", () => {
        areaPick.value = String(i);
        areaPick.dispatchEvent(new Event("change"));
        status.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      return tr;
    })
  );
  $("yoy-table-head").textContent = toDay ? `All districts · to ${nice(dayOf(current, toDay - 1))}, most above average first` : "All districts";
}

function draw() {
  if (!seasons) return;
  const area = areaIndex();
  const c = compare(seasons, current, toDay, area);
  $("yoy-title").textContent = `${areaName()} · northeast monsoon ${current}`;
  drawSummary(c, area);
  drawCumulative(c);
  drawYears(c);
  drawTable();
}

async function refresh(force = false) {
  if (busy) return;
  busy = true;
  const s = seasonNow();
  current = s.year;
  toDay = s.days;
  if (toDay < SEASON_DAYS)
    seasonByDistrict()
      .then((p) => {
        imd = { ...p, at: Date.now() };
        draw();
      })
      .catch(() => {});
  const years = Array.from({ length: current - FIRST + 1 }, (_, i) => current - i); // newest first
  const got = {};
  let failed = 0;
  let lastError = "";
  let done = 0;
  try {
    // Three at a time; past seasons come from the phone after the first time.
    let next = 0;
    const worker = async () => {
      while (next < years.length) {
        const y = years[next++];
        try {
          got[y] = await loadSeason(y, force);
        } catch (e) {
          failed++;
          lastError = e.message;
        }
        done++;
        if (done < years.length) status.textContent = `Loading seasons… ${done} of ${years.length}`;
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    seasons = got;
    if (!Object.keys(got).length) {
      status.textContent = /Failed to fetch|NetworkError|Load failed/.test(lastError)
        ? "Couldn't reach Open-Meteo. Check the connection and try again."
        : `Couldn't load the seasons (${lastError}).`;
      status.className = "status error";
      return;
    }
    draw();
    loadedAt = Date.now();
    status.textContent = failed ? `${failed} season(s) couldn't be loaded (${lastError}); try Refresh.` : `Updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    status.className = failed ? "status error" : "status";
  } finally {
    busy = false;
  }
}

export function initYoy() {
  areaPick.replaceChildren(...AREAS.map((a, i) => new Option(a[1], String(i))), new Option("Tamil Nadu (all districts)", TN));
  // Unless picked here, the home district from Settings.
  areaPick.value = matchDistrict(areaPick.options) ?? areaPick.options[0].value;
  try {
    const a = localStorage.getItem(AREA_KEY);
    if (a && [...areaPick.options].some((o) => o.value === a)) areaPick.value = a;
  } catch {}
  areaPick.addEventListener("change", () => {
    try {
      localStorage.setItem(AREA_KEY, areaPick.value);
    } catch {}
    draw();
  });
  $("yoy-refresh").addEventListener("click", () => refresh(true));
}

export function showYoy() {
  if (Date.now() - loadedAt > TTL) refresh();
  else draw();
}
