// Heat & humidity, last 30 days (#heat): the hottest feels-like (heat index)
// and average humidity of each day for the place chosen on the screen
// (Chennai unless changed), and how many hot days in a row there have been.
//
// Open-Meteo's hourly model values for the past days (no key): modelled, not
// measured. A "hot day" is a day whose hottest feels-like reached the level
// picked here (38° by default). The streak counts hot days up to today; today
// only counts once it is hot, and doesn't break the streak before 5 pm.
import { drawLines } from "./chart.js";
import { when } from "./offline.js";
import { heatIndex, levelOf } from "./heat.js";
import { toTemp, tempUnit } from "./prefs.js";

const SAVED_KEY = "myweather.heat.trend";
const HOT_KEY = "myweather.heat.hotAt";
const DAYS = 30;
const LEVEL_AT = [32, 35, 38, 41]; // °C feels like
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const $ = (id) => document.getElementById(id);
const r0 = (v) => (typeof v === "number" ? String(Math.round(v)) : "–");
const T = (c) => r0(toTemp(c));

let data = null; // { at, hourly, where }

function hotAt() {
  try {
    const v = Number(localStorage.getItem(HOT_KEY));
    if (LEVEL_AT.includes(v)) return v;
  } catch {}
  return 38;
}

const url = (p) =>
  "https://api.open-meteo.com/v1/forecast?" +
  new URLSearchParams({
    latitude: p.lat.toFixed(3),
    longitude: p.lon.toFixed(3),
    timezone: "Asia/Kolkata",
    past_days: DAYS - 1,
    forecast_days: 1,
    hourly: "temperature_2m,relative_humidity_2m",
  });

const istNow = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 16);

/** One entry per day, oldest first: hottest feel, hottest air, average humidity. */
export function summarise(h, now = istNow()) {
  const byDay = new Map();
  h.time.forEach((t, i) => {
    if (t > now) return; // hours still to come today are a forecast
    const hi = heatIndex(h.temperature_2m[i], h.relative_humidity_2m[i]);
    if (typeof hi !== "number") return;
    const day = t.slice(0, 10);
    const d = byDay.get(day) || { day, hi: -99, air: -99, rhSum: 0, n: 0 };
    if (hi > d.hi) Object.assign(d, { hi, at: t, rhAtPeak: h.relative_humidity_2m[i] });
    d.air = Math.max(d.air, h.temperature_2m[i]);
    d.rhSum += h.relative_humidity_2m[i];
    d.n++;
    byDay.set(day, d);
  });
  return [...byDay.values()].map((d) => ({ ...d, rh: d.rhSum / d.n }));
}

/** Hot days in a row up to the latest day, the longest run, and the count. */
export function streaks(days, threshold, hour = Number(istNow().slice(11, 13))) {
  const hot = days.map((d) => d.hi >= threshold);
  let end = days.length - 1;
  // Today isn't over: if it isn't hot yet, the streak is judged to yesterday.
  const todayOpen = hour < 17;
  if (end >= 0 && !hot[end] && todayOpen) end--;
  let current = 0;
  while (end - current >= 0 && hot[end - current]) current++;
  let longest = 0;
  let run = 0;
  for (const h of hot) {
    run = h ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return { current, longest, count: hot.filter(Boolean).length, hot };
}

const dayLabel = (day) => {
  const d = new Date(`${day}T00:00`);
  return `${DOW[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
};

function render() {
  if (!data) return;
  const days = summarise(data.hourly);
  const box = $("heat-streak");
  if (days.length < 2) {
    box.className = "heat-now heat-none";
    box.textContent = "Not enough days yet.";
    return;
  }
  const th = hotAt();
  const s = streaks(days, th);
  const peak = days.reduce((a, b) => (b.hi > a.hi ? b : a));
  const l = levelOf(days[days.length - 1].hi);
  box.className = `heat-now heat-${s.current ? levelOf(th).cls : "ok"}`;
  box.innerHTML = `
    <div class="heat-big"><b></b><small>hot days in a row</small></div>
    <div class="heat-facts">
      <span><small>Hot days in ${days.length}</small><b></b></span>
      <span><small>Longest run</small><b></b></span>
      <span><small>Hottest feel</small><b></b></span>
    </div>
    <p class="heat-advice"></p>`;
  box.querySelector(".heat-big b").textContent = String(s.current);
  const [count, longest, hottest] = box.querySelectorAll(".heat-facts b");
  count.textContent = String(s.count);
  longest.textContent = `${s.longest} ${s.longest === 1 ? "day" : "days"}`;
  hottest.textContent = `${T(peak.hi)}°`;
  box.querySelector(".heat-advice").textContent =
    `A hot day is one where it felt like ${T(th)}° or more. ` +
    (s.current
      ? `The last ${s.current === 1 ? "day was" : `${s.current} days were`} hot.`
      : `Latest day: ${l ? l.name.toLowerCase() : "–"}, feeling like ${T(days[days.length - 1].hi)}°.`) +
    ` Hottest: ${dayLabel(peak.day)}.`;

  // Chart: hottest air and hottest feel for each day.
  const feel = days.map((d) => toTemp(d.hi));
  const air = days.map((d) => toTemp(d.air));
  const all = [...feel, ...air];
  const min = Math.floor(Math.min(...all)) - 1;
  const max = min + 4 * Math.ceil((Math.max(...all) + 2 - min) / 4);
  const ticks = days.map((d, k) => (k % 7 === (days.length - 1) % 7 ? { at: k, label: `${Number(d.day.slice(8))}/${Number(d.day.slice(5, 7))}` } : null)).filter(Boolean);
  drawLines(
    $("heat-trend"),
    $("heat-trend-readout"),
    {
      count: days.length,
      series: [
        { values: air, cls: "air" },
        { values: feel, cls: "feels" },
      ],
      ticks,
      points: days.map((d, k) => {
        const lv = levelOf(d.hi);
        return {
          at: k,
          text:
            `${k === days.length - 1 ? "Today so far" : dayLabel(d.day)} · feels ${T(d.hi)}° (${lv ? lv.name : "–"}${s.hot[k] ? ", hot day" : ""}) · ` +
            `hottest air ${T(d.air)}° · humidity ${r0(d.rh)}% average, ${r0(d.rhAtPeak)}% at the peak`,
        };
      }),
      marks: [{ at: days.indexOf(peak), value: toTemp(peak.hi), label: `${T(peak.hi)}°` }],
    },
    "Tap the chart for any day.",
    { unit: tempUnit(), min, max }
  );

  // Heat stress level of each day, hot days marked.
  const strip = $("heat-trend-strip");
  strip.style.gridTemplateColumns = `repeat(${days.length}, 1fr)`;
  strip.replaceChildren(
    ...days.map((d, k) => {
      const lv = levelOf(d.hi);
      const i = document.createElement("i");
      i.style.background = lv ? lv.color : "var(--grid)";
      if (s.hot[k]) i.className = "hot";
      i.title = `${dayLabel(d.day)}: ${lv ? lv.name : "–"}`;
      return i;
    })
  );

  // Humidity.
  const hum = days.map((d) => Math.round(d.rh));
  drawLines(
    $("heat-hum"),
    $("heat-hum-readout"),
    {
      count: days.length,
      series: [{ values: hum, cls: "humid" }],
      ticks,
      points: days.map((d, k) => ({
        at: k,
        text: `${k === days.length - 1 ? "Today so far" : dayLabel(d.day)} · humidity ${r0(d.rh)}% average, ${r0(d.rhAtPeak)}% when it felt hottest`,
      })),
    },
    "Tap the chart for any day.",
    { unit: "%", min: 0, max: 100 }
  );
  $("heat-trend-status").textContent = `${data.where.name} · model estimates for each hour, not measurements${data.at ? ` · ${when(data.at)}` : ""}`;
}

/** Called by the Heat screen whenever it loads for a place. */
export async function showTrend(where) {
  const note = $("heat-trend-status");
  note.textContent = "Loading the last 30 days…";
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch(url(where), { signal: ctrl.signal }).finally(() => clearTimeout(timer));
    const j = await res.json();
    if (!res.ok || j.error) throw new Error(j.reason || `HTTP ${res.status}`);
    data = { at: Date.now(), hourly: j.hourly, where };
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(data));
    } catch {}
    render();
  } catch (e) {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(SAVED_KEY));
    } catch {}
    if (saved?.hourly) {
      data = saved;
      render();
      note.textContent = `Couldn't load new figures. Showing ${data.where.name} from ${when(saved.at)}.`;
    } else note.textContent = `Couldn't load the last 30 days (${e.message}). Try Refresh.`;
  }
}

export function initTrend() {
  const sel = $("heat-hot-at");
  sel.replaceChildren(...LEVEL_AT.map((c) => new Option(`${T(c)}${tempUnit()}${c === 41 ? " (extreme caution)" : ""}`, String(c))));
  sel.value = String(hotAt());
  sel.addEventListener("change", () => {
    try {
      localStorage.setItem(HOT_KEY, sel.value);
    } catch {}
    render();
  });
}
