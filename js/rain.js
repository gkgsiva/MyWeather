// Rain history from Wunderground (api.weather.com, same key as the dashboard).
//
// - #rain: every saved station's rain for the last 7 days, to compare areas
//   after a heavy spell (one dailysummary/7day request per station).
// - #rain?id=ICHENN47&month=2026-11: one station's rain per day for a month,
//   and per month for the last 12 months.
//
// Wunderground gives one day's summary per history request, so each finished
// day is kept on the phone (localStorage) and never asked for again; only today
// is fetched again. Requests are spaced out to stay inside the key's limits
// (about 30 a minute and 1,500 a day for a station owner's key).
import { loadStations, apiKey } from "./wunderground.js";
import { routeParams } from "./route.js";

const API = "https://api.weather.com/v2/pws";
const CACHE_PREFIX = "myweather.rain.";
const GAP_MS = 2100; // between history requests: under 30 a minute
const COMPARE_TTL = 10 * 60 * 1000;

const $ = (id) => document.getElementById(id);
const select = $("rain-station");
const status = $("rain-status");
const compareBox = $("rain-compare");
const stationBox = $("rain-station-view");
const monthLabel = $("rain-month-label");
const dailyChart = $("rain-daily");
const dailyReadout = $("rain-daily-readout");
const monthlyChart = $("rain-monthly");
const monthlyReadout = $("rain-monthly-readout");
const loadYearBtn = $("rain-load-year");
const yearNote = $("rain-year-note");

let stations = [];
let today = {}; // id -> { "YYYY-MM-DD": mm } for today (not cached)
let compareAt = 0;
let run = 0; // bumps to cancel the request queue on navigation

// ---- Dates (phone time, IST for Chennai) ----

const pad = (n) => String(n).padStart(2, "0");
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayKey = () => dayKey(new Date());
const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const parseMonth = (m) => {
  const [y, mo] = (m || "").split("-").map(Number);
  return y > 2000 && mo >= 1 && mo <= 12 ? new Date(y, mo - 1, 1) : null;
};
const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);
const daysIn = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthName = (d) => `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

// Days of a month up to today, as "YYYY-MM-DD".
function monthDays(m) {
  const out = [];
  const now = todayKey();
  for (let i = 1; i <= daysIn(m); i++) {
    const k = dayKey(new Date(m.getFullYear(), m.getMonth(), i));
    if (k > now) break;
    out.push(k);
  }
  return out;
}

// ---- Cache of finished days: { "YYYY-MM-DD": mm | null (no data) } ----

function cacheGet(id) {
  try {
    return JSON.parse(localStorage.getItem(CACHE_PREFIX + id)) || {};
  } catch {
    return {};
  }
}

function cachePut(id, values) {
  const now = todayKey();
  const c = cacheGet(id);
  for (const [k, v] of Object.entries(values)) {
    if (k < now) c[k] = v;
    else if (k === now) (today[id] ||= {})[k] = v;
  }
  try {
    localStorage.setItem(CACHE_PREFIX + id, JSON.stringify(c));
  } catch {}
}

// Rain for a day: a number, null (station sent nothing), or undefined (not loaded).
function rainOn(id, k) {
  if (k === todayKey()) return today[id]?.[k];
  return cacheGet(id)[k];
}

// ---- Requests ----

class KeyError extends Error {}
class LimitError extends Error {}

async function get(path, params) {
  const key = apiKey();
  if (!key) throw new KeyError("no key");
  const qs = new URLSearchParams({ ...params, format: "json", units: "m", numericPrecision: "decimal", apiKey: key });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(`${API}/${path}?${qs}`, { signal: ctrl.signal });
    if (res.status === 204 || res.status === 404) return null;
    if (res.status === 401 || res.status === 403) throw new KeyError("key");
    if (res.status === 429) throw new LimitError("limit");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const localDate = (s) => (typeof s === "string" ? s.slice(0, 10) : "");

// Last 7 days (today included) in one request.
async function fetch7Days(id) {
  const body = await get("dailysummary/7day", { stationId: id });
  const values = {};
  for (const d of body?.summaries || []) {
    const k = localDate(d.obsTimeLocal) || (d.epoch ? dayKey(new Date(d.epoch * 1000)) : "");
    if (k) values[k] = typeof d.metric?.precipTotal === "number" ? d.metric.precipTotal : null;
  }
  cachePut(id, values);
  return values;
}

// One day's total.
async function fetchDay(id, k) {
  const body = await get("history/daily", { stationId: id, date: k.replaceAll("-", "") });
  const obs = body?.observations?.[0];
  const v = typeof obs?.metric?.precipTotal === "number" ? obs.metric.precipTotal : null;
  cachePut(id, { [k]: v });
  return v;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fetches the given days one by one, newest first, calling onDay after each.
// Stops when the screen changes (run bumps). Returns a reason it stopped, or "".
async function fetchDays(id, keys, myRun, onDay) {
  let left = keys.filter((k) => rainOn(id, k) === undefined).sort().reverse();
  while (left.length) {
    if (myRun !== run) return "cancelled";
    const k = left[0];
    try {
      await fetchDay(id, k);
      left.shift();
      onDay(left.length);
    } catch (e) {
      if (e instanceof KeyError) return "key";
      if (e instanceof LimitError) {
        say("Wunderground's per-minute limit was reached; carrying on in a minute…");
        await sleep(60000);
        continue;
      }
      return "network";
    }
    await sleep(GAP_MS);
  }
  return "";
}

function say(text, error = false) {
  status.textContent = text;
  status.className = error ? "status error" : "status";
}

function sayStop(reason) {
  if (reason === "key") say("Wunderground didn't accept the API key. Check it under Wunderground → Manage stations.", true);
  else if (reason === "network") say("Couldn't reach Wunderground. Days loaded so far are kept; try Refresh.", true);
}

const fmt = (v) => (typeof v === "number" ? v.toFixed(1) : "–");
// Narrow table cells: "0", "4.2", "35".
const short = (v) => (typeof v !== "number" ? "–" : v === 0 ? "0" : v < 10 ? v.toFixed(1) : String(Math.round(v)));

// ---- Bar chart (SVG) ----

const NS = "http://www.w3.org/2000/svg";
function el(name, attrs = {}, text) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
}

// Rounds the top of the axis up to 1, 2, 2.5 or 5 × 10^n.
function niceMax(v) {
  if (!(v > 0)) return 10;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v);
}

// bars: [{ label, tick, value (number|null|undefined), partial, text }]
function drawBars(svg, readout, bars, emptyText) {
  const W = 360;
  const H = 190;
  const L = 34;
  const R = 6;
  const T = 14;
  const B = 22;
  const max = niceMax(Math.max(0, ...bars.map((b) => b.value || 0)));
  const step = (W - L - R) / bars.length;
  const bw = Math.max(2, Math.min(22, step - 2));
  const y = (v) => T + (H - T - B) * (1 - v / max);
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.replaceChildren();

  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    svg.append(el("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: "grid" }));
    svg.append(el("text", { x: L - 4, y: y(v) + 3, class: "axis", "text-anchor": "end" }, String(+v.toFixed(1))));
  }
  svg.append(el("text", { x: 2, y: 9, class: "axis" }, "mm"));

  let top = -1;
  bars.forEach((b, i) => {
    if (typeof b.value === "number" && (top < 0 || b.value > bars[top].value)) top = i;
  });

  bars.forEach((b, i) => {
    const cx = L + step * i + step / 2;
    if (b.tick) svg.append(el("text", { x: cx, y: H - 6, class: "axis", "text-anchor": "middle" }, b.tick));
    const g = el("g", { class: "bar", tabindex: "0", role: "img", "aria-label": b.text });
    // Hit target: the whole column.
    g.append(el("rect", { x: cx - step / 2, y: T, width: step, height: H - T - B, class: "hit" }));
    if (typeof b.value === "number" && b.value > 0) {
      const h = Math.max(1, y(0) - y(b.value));
      const r = Math.min(4, bw / 2, h);
      // Rounded top, square base on the axis.
      const x0 = cx - bw / 2;
      const y0 = y(0);
      const d = `M${x0},${y0}V${y0 - h + r}Q${x0},${y0 - h} ${x0 + r},${y0 - h}H${x0 + bw - r}Q${x0 + bw},${y0 - h} ${x0 + bw},${y0 - h + r}V${y0}Z`;
      g.append(el("path", { d, class: b.partial ? "fill partial" : "fill" }));
    } else if (b.value === undefined) {
      g.append(el("rect", { x: cx - bw / 2, y: y(0) - 2, width: bw, height: 2, class: "pending" }));
    }
    const show = () => {
      readout.textContent = b.text;
      for (const s of svg.querySelectorAll(".bar.on")) s.classList.remove("on");
      g.classList.add("on");
    };
    g.addEventListener("click", show);
    g.addEventListener("focus", show);
    svg.append(g);
  });
  svg.append(el("line", { x1: L, x2: W - R, y1: y(0), y2: y(0), class: "baseline" }));

  if (top >= 0 && bars[top].value > 0) {
    const cx = L + step * top + step / 2;
    svg.append(el("text", { x: cx, y: y(bars[top].value) - 4, class: "peak", "text-anchor": "middle" }, fmt(bars[top].value)));
  }
  readout.textContent = emptyText;
}

// ---- All stations, last 7 days ----

async function showCompare() {
  compareBox.hidden = false;
  stationBox.hidden = true;
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(dayKey(d));
  }
  const thead = $("rain-compare-table").querySelector("thead tr");
  const tbody = $("rain-compare-table").querySelector("tbody");
  thead.replaceChildren(
    Object.assign(document.createElement("th"), { scope: "col", textContent: "Station" }),
    ...days.map((k) => {
      const th = document.createElement("th");
      th.scope = "col";
      const d = new Date(`${k}T00:00`);
      const first = k === days[0] || d.getDate() === 1;
      th.innerHTML = `${d.getDate()}<br><small>${first ? MONTHS[d.getMonth()] : "&nbsp;"}</small>`;
      return th;
    }),
    Object.assign(document.createElement("th"), { scope: "col", innerHTML: "Total<br><small>mm</small>" })
  );

  const draw = () =>
    tbody.replaceChildren(
      ...stations.map((s) => {
        const tr = document.createElement("tr");
        tr.tabIndex = 0;
        const open = () => (location.hash = `#rain?id=${encodeURIComponent(s.id)}`);
        tr.addEventListener("click", open);
        tr.addEventListener("keydown", (e) => e.key === "Enter" && open());
        const th = document.createElement("th");
        th.scope = "row";
        th.textContent = s.name;
        tr.append(th);
        let total = 0;
        let known = 0;
        for (const k of days) {
          const v = rainOn(s.id, k);
          const td = document.createElement("td");
          td.textContent = v === undefined ? "…" : short(v);
          if (typeof v === "number") {
            total += v;
            known++;
            if (v >= 10) td.className = "raining";
          }
          tr.append(td);
        }
        const td = document.createElement("td");
        td.className = "total";
        td.textContent = known ? short(total) : "–";
        tr.append(td);
        return tr;
      })
    );
  draw();

  if (!apiKey()) {
    say("Add your Wunderground API key under Wunderground → Manage stations to see rain history.", true);
    return;
  }
  if (Date.now() - compareAt < COMPARE_TTL) return;
  const myRun = run;
  say("Loading the last 7 days for each station…");
  let keyError = false;
  let failed = 0;
  // A few at a time, to go easy on the key's per-minute limit.
  const queue = [...new Set(stations.map((s) => s.id))];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (queue.length) {
        const id = queue.shift();
        try {
          await fetch7Days(id);
        } catch (e) {
          if (e instanceof KeyError) keyError = true;
          failed++;
        }
        if (myRun === run) draw();
      }
    })
  );
  if (myRun !== run) return;
  if (keyError) return sayStop("key");
  if (failed === stations.length) return sayStop("network");
  compareAt = Date.now();
  say(`Updated ${new Date().toLocaleTimeString()}${failed ? ` · ${failed} station(s) didn't answer` : ""}. Tap a station for its charts.`);
}

// ---- One station ----

function drawDaily(id, m) {
  const keys = monthDays(m);
  const bars = [];
  for (let i = 1; i <= daysIn(m); i++) {
    const k = dayKey(new Date(m.getFullYear(), m.getMonth(), i));
    const future = !keys.includes(k);
    const v = future ? null : rainOn(id, k);
    const label = `${i} ${MONTHS[m.getMonth()]}`;
    bars.push({
      value: future ? null : v,
      tick: i === 1 || i % 5 === 0 ? String(i) : "",
      text: future
        ? `${label}: not yet`
        : v === undefined
          ? `${label}: loading…`
          : v === null
            ? `${label}: no data from the station`
            : `${label}: ${fmt(v)} mm${k === todayKey() ? " so far today" : ""}`,
    });
  }
  const total = keys.reduce((t, k) => t + (rainOn(id, k) || 0), 0);
  const loaded = keys.filter((k) => rainOn(id, k) !== undefined).length;
  drawBars(
    dailyChart,
    dailyReadout,
    bars,
    `${monthName(m)}: ${total.toFixed(1)} mm${loaded < keys.length ? ` (${loaded} of ${keys.length} days loaded)` : ""}. Tap a bar for the day.`
  );
}

function last12() {
  const out = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) out.push(addMonths(new Date(now.getFullYear(), now.getMonth(), 1), -i));
  return out;
}

function drawMonthly(id) {
  const months = last12();
  let missing = 0;
  const bars = months.map((m) => {
    const keys = monthDays(m);
    const vals = keys.map((k) => rainOn(id, k));
    const known = vals.filter((v) => v !== undefined).length;
    missing += keys.length - known;
    const total = vals.reduce((t, v) => t + (v || 0), 0);
    const partial = known < keys.length;
    return {
      value: known ? total : undefined,
      partial,
      tick: MONTHS[m.getMonth()].slice(0, 1),
      text: known
        ? `${monthName(m)}: ${total.toFixed(1)} mm${partial ? ` (${known} of ${keys.length} days loaded)` : ""}`
        : `${monthName(m)}: not loaded yet`,
    };
  });
  drawBars(monthlyChart, monthlyReadout, bars, "Tap a bar for the month. Lighter bars are months not fully loaded.");
  loadYearBtn.hidden = missing === 0;
  loadYearBtn.disabled = false;
  const mins = Math.ceil((missing * GAP_MS) / 60000);
  yearNote.textContent = missing
    ? `${missing} days still to load, about ${mins} minute${mins === 1 ? "" : "s"}. Each day is fetched once and kept on the phone. Keep this screen open while it loads.`
    : "All 12 months are loaded.";
  return months;
}

async function showStation(id) {
  compareBox.hidden = true;
  stationBox.hidden = false;
  const s = stations.find((x) => x.id === id);
  $("rain-station-name").textContent = s ? `${s.name} (${id})` : id;
  $("rain-open-pws").href = `#wunderground?id=${encodeURIComponent(id)}`;

  const now = new Date();
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  let m = parseMonth(routeParams().get("month")) || thisMonth;
  if (m > thisMonth) m = thisMonth;
  monthLabel.textContent = monthName(m);
  const go = (d) => {
    const qs = new URLSearchParams({ id, month: monthKey(d) });
    location.hash = `#rain?${qs}`;
  };
  $("rain-prev").onclick = () => go(addMonths(m, -1));
  $("rain-next").onclick = () => go(addMonths(m, 1));
  $("rain-next").disabled = m >= thisMonth;

  const redraw = () => {
    drawDaily(id, m);
    drawMonthly(id);
  };
  redraw();

  if (!apiKey()) {
    say("Add your Wunderground API key under Wunderground → Manage stations to see rain history.", true);
    return;
  }
  const myRun = run;
  loadYearBtn.onclick = async () => {
    loadYearBtn.disabled = true;
    // Replaces the month's loader (the year includes this month).
    const yearRun = ++run;
    const keys = last12().flatMap(monthDays);
    const reason = await fetchDays(id, keys, yearRun, (left) => {
      redraw();
      say(`Loading the last 12 months… ${left} days to go.`);
    });
    if (reason !== "cancelled") {
      redraw();
      reason ? sayStop(reason) : say("All 12 months loaded.");
    }
  };

  say("Loading…");
  try {
    await fetch7Days(id);
  } catch (e) {
    if (myRun !== run) return;
    if (e instanceof KeyError) return sayStop("key");
  }
  if (myRun !== run) return;
  redraw();
  const reason = await fetchDays(id, monthDays(m), myRun, (left) => {
    redraw();
    say(`Loading ${monthName(m)}… ${left} days to go.`);
  });
  if (reason === "cancelled") return;
  redraw();
  if (reason) sayStop(reason);
  else say(`Updated ${new Date().toLocaleTimeString()}`);
}

function renderPicker(current) {
  select.replaceChildren(
    new Option("All stations · last 7 days", ""),
    ...stations.map((s) => new Option(`${s.name} (${s.id})`, s.id))
  );
  select.value = stations.some((s) => s.id === current) ? current : "";
}

export function initRain() {
  select.addEventListener("change", () => {
    location.hash = select.value ? `#rain?id=${encodeURIComponent(select.value)}` : "#rain";
  });
  $("rain-refresh").addEventListener("click", () => {
    compareAt = 0;
    today = {};
    showRain();
  });
}

export function showRain() {
  run++;
  stations = loadStations();
  const id = routeParams().get("id") || "";
  renderPicker(id);
  if (id) showStation(id.toUpperCase());
  else showCompare();
}

// Leaving the screen stops the request queue.
export function hideRain() {
  run++;
}
