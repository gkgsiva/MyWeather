// Air quality (#air): Chennai's air quality index on India's National AQI
// scale (CPCB's bands and breakpoints), for now and the next few days.
//
// - The index is worked out here from pollutant levels forecast by the
//   Copernicus Atmosphere Monitoring Service (CAMS), served by Open-Meteo
//   (air-quality-api.open-meteo.com, no key): PM2.5, PM10, NO2 and SO2 as
//   24-hour averages, CO and ozone as 8-hour averages, as CPCB does. CAMS is a
//   model over a ~40 km grid, so it gives one figure for the city, not by area.
// - Measured readings for each area come from CPCB's own stations (Alandur,
//   Velachery, Manali, Kodungaiyur, Perungudi, Arumbakkam, Royapuram…). CPCB
//   has no public data feed for apps, so its page opens under the menu
//   (#air?page=1).
import { routeParams, IN_APP } from "./route.js";
import { drawBars } from "./chart.js";
import { when } from "./offline.js";

export const CPCB_PAGE = "https://airquality.cpcb.gov.in/AQI_India/";
const SAVED_KEY = "myweather.air.last";
const TTL = 30 * 60 * 1000;
const URL_AQ =
  "https://air-quality-api.open-meteo.com/v1/air-quality?" +
  new URLSearchParams({
    latitude: 13.0827,
    longitude: 80.2707,
    timezone: "Asia/Kolkata",
    past_days: 1,
    forecast_days: 4,
    hourly: "pm2_5,pm10,nitrogen_dioxide,sulphur_dioxide,carbon_monoxide,ozone",
  });

// CPCB National AQI breakpoints: concentration bands for AQI 0–50, 51–100,
// 101–200, 201–300, 301–400 and 401–500. µg/m³, except CO in mg/m³.
const BANDS = [
  [0, 50],
  [51, 100],
  [101, 200],
  [201, 300],
  [301, 400],
  [401, 500],
];
const BREAKS = {
  pm2_5: { name: "PM2.5", hours: 24, c: [[0, 30], [31, 60], [61, 90], [91, 120], [121, 250], [251, 380]] },
  pm10: { name: "PM10", hours: 24, c: [[0, 50], [51, 100], [101, 250], [251, 350], [351, 430], [431, 510]] },
  nitrogen_dioxide: { name: "NO₂", hours: 24, c: [[0, 40], [41, 80], [81, 180], [181, 280], [281, 400], [401, 520]] },
  sulphur_dioxide: { name: "SO₂", hours: 24, c: [[0, 40], [41, 80], [81, 380], [381, 800], [801, 1600], [1601, 2100]] },
  carbon_monoxide: { name: "CO", hours: 8, scale: 1 / 1000, unit: "mg/m³", c: [[0, 1], [1.1, 2], [2.1, 10], [10.1, 17], [17.1, 34], [34.1, 50]] },
  ozone: { name: "O₃", hours: 8, c: [[0, 50], [51, 100], [101, 168], [169, 208], [209, 748], [749, 1000]] },
};
export const LEVELS = [
  { max: 50, name: "Good", cls: "good", advice: "Minimal impact." },
  { max: 100, name: "Satisfactory", cls: "sat", advice: "Minor breathing discomfort for sensitive people." },
  { max: 200, name: "Moderate", cls: "mod", advice: "Breathing discomfort for people with lung or heart disease, children and older adults." },
  { max: 300, name: "Poor", cls: "poor", advice: "Breathing discomfort for most people on long exposure." },
  { max: 400, name: "Very poor", cls: "vpoor", advice: "Respiratory illness on long exposure." },
  { max: 1e9, name: "Severe", cls: "severe", advice: "Affects healthy people; serious for those with existing disease." },
];
export const level = (aqi) => LEVELS.find((l) => aqi <= l.max);

// Sub-index for one pollutant (linear within its band, as CPCB does).
export function subIndex(key, conc) {
  const b = BREAKS[key];
  if (typeof conc !== "number" || !b) return null;
  const c = Math.max(0, conc);
  for (let i = 0; i < b.c.length; i++) {
    const [lo, hi] = b.c[i];
    const next = b.c[i + 1]?.[0] ?? Infinity;
    if (c < next || i === b.c.length - 1) {
      const [ilo, ihi] = BANDS[i];
      const x = Math.min(c, hi);
      return Math.round(ilo + ((ihi - ilo) * (Math.max(x, lo) - lo)) / (hi - lo));
    }
  }
  return null;
}

const mean = (a) => {
  const v = a.filter((x) => typeof x === "number");
  return v.length >= a.length * 0.75 && v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
};

// The AQI at hour i: the highest sub-index, from 24- or 8-hour means ending at i.
// CPCB needs PM2.5 or PM10 among at least three pollutants; CAMS gives all six.
export function aqiAt(h, i) {
  let best = null;
  const parts = {};
  for (const [key, b] of Object.entries(BREAKS)) {
    const series = h[key];
    if (!series || i + 1 < b.hours) continue;
    const m = mean(series.slice(i + 1 - b.hours, i + 1));
    if (m === null) continue;
    const conc = m * (b.scale || 1);
    const si = subIndex(key, conc);
    parts[key] = { conc, si };
    if (si !== null && (!best || si > best.si)) best = { key, si };
  }
  if (!best || !(parts.pm2_5 || parts.pm10)) return null;
  return { aqi: best.si, main: best.key, parts };
}

const $ = (id) => document.getElementById(id);
const status = $("air-status");
const home = $("air-home");
const reader = $("air-reader");
const frame = $("air-frame");

let loadedAt = 0;

function say(text, error = false) {
  status.textContent = text;
  status.className = error ? "status error" : "status";
}

const localHour = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 13) + ":00";
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function render(data) {
  const h = data.hourly;
  let now = h.time.findIndex((t) => t >= localHour());
  if (now < 0) now = h.time.length - 1;
  const cur = aqiAt(h, now);
  const box = $("air-now");
  if (!cur) {
    box.hidden = true;
    say("The air-quality forecast came without enough data to work out the index.", true);
    return;
  }
  box.hidden = false;
  const lv = level(cur.aqi);
  box.className = `air-now aqi-${lv.cls}`;
  box.querySelector(".air-aqi").textContent = String(cur.aqi);
  box.querySelector(".air-level").textContent = lv.name;
  box.querySelector(".air-main").textContent = `Main pollutant: ${BREAKS[cur.main].name}`;
  box.querySelector(".air-advice").textContent = lv.advice;

  $("air-parts").replaceChildren(
    ...Object.entries(BREAKS).map(([key, b]) => {
      const p = cur.parts[key];
      const li = document.createElement("li");
      const plv = p ? level(p.si) : null;
      li.className = plv ? `aqi-${plv.cls}` : "";
      li.innerHTML = `<span></span><b></b><small></small>`;
      li.querySelector("span").textContent = b.name;
      li.querySelector("b").textContent = p ? String(p.si) : "–";
      li.querySelector("small").textContent = p
        ? `${p.conc < 10 ? p.conc.toFixed(1) : Math.round(p.conc)} ${b.unit || "µg/m³"} · ${b.hours} h avg`
        : "";
      return li;
    })
  );

  // Every 3 hours over the coming days.
  const bars = [];
  for (let i = now; i < h.time.length; i += 3) {
    const a = aqiAt(h, i);
    const t = h.time[i];
    const d = new Date(`${t.slice(0, 10)}T00:00`);
    const hour = Number(t.slice(11, 13));
    const lvl = a ? level(a.aqi) : null;
    bars.push({
      value: a ? a.aqi : null,
      cls: lvl ? `aqi-${lvl.cls}` : "",
      tick: i === now ? "now" : hour < 3 ? DAYS[d.getDay()] : "",
      text: a
        ? `${i === now ? "Now" : `${DAYS[d.getDay()]} ${t.slice(11, 16)}`} · AQI ${a.aqi}, ${lvl.name} (${BREAKS[a.main].name})`
        : `${t.slice(11, 16)}: no data`,
    });
  }
  const worst = bars.reduce((x, b) => ((b.value ?? -1) > (x?.value ?? -1) ? b : x), null);
  drawBars($("air-chart"), $("air-readout"), bars, worst ? `Highest ahead: ${worst.text}. Tap a bar for any time.` : "", {
    unit: "AQI",
    max: Math.max(100, Math.ceil(((worst?.value || 0) + 1) / 50) * 50),
    peak: false,
  });
}

function loadSaved() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVED_KEY));
    return s && s.at && s.data ? s : null;
  } catch {
    return null;
  }
}

async function refresh() {
  say("Loading air quality…");
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch(URL_AQ, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.reason || `HTTP ${res.status}`);
    render(data);
    loadedAt = Date.now();
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify({ at: loadedAt, data }));
    } catch {}
    say(`Updated ${new Date().toLocaleTimeString()}`);
  } catch (e) {
    const saved = loadSaved();
    if (saved) {
      render(saved.data);
      say(`Couldn't load new figures. Showing those saved at ${when(saved.at)}.`, true);
    } else {
      say(`Couldn't load air quality (${e.message}). Try Refresh.`, true);
    }
  }
}

export function initAir() {
  $("air-refresh").addEventListener("click", refresh);
}

export function showAir() {
  const page = routeParams().get("page");
  home.hidden = !!page;
  reader.hidden = !page;
  if (page) {
    if (frame.dataset.src !== CPCB_PAGE) {
      frame.dataset.src = CPCB_PAGE;
      frame.src = CPCB_PAGE;
    }
    $("air-frame-note").hidden = IN_APP;
    return;
  }
  if (Date.now() - loadedAt > TTL) refresh();
}
