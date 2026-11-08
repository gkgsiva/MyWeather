// Station health (#health): which Wunderground stations and TN-SMART rain
// gauges are offline or sending readings that don't add up, so they can be
// left out of the maps, averages and rankings.
//
// The checks are simple and compare each station with its own other readings
// and with its neighbours. A flag is a reason to doubt a reading, not proof:
// a real cloudburst can fall on one gauge only. Two levels:
//   bad  – can't be right (an impossible value, totals that don't add up);
//   odd  – very unlike every station around it; left out by default too.
// The gauges screen and the station map use the same checks.
import { gaugeKey, currentRainDay, niceDay, shiftDay, BASE } from "./gaugedays.js";
import { loadStations, apiKey } from "./wunderground.js";
import { fetchAll, loadCoords } from "./stationmap.js";
import { km } from "./floods.js";

const HOUR_RE = /^\d\d:\d\d [AP]M$/;
export const SKIP_KEY = "myweather.health.skip"; // "0" shows suspect readings everywhere

/** Whether suspect readings are left out of maps and averages (on unless turned off). */
export function skipSuspects() {
  try {
    return localStorage.getItem(SKIP_KEY) !== "0";
  } catch {
    return true;
  }
}
export function setSkipSuspects(on) {
  try {
    localStorage.setItem(SKIP_KEY, on ? "1" : "0");
  } catch {}
}

const median = (v) => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const r1 = (v) => (Math.round(v * 10) / 10).toString();

// Neighbours within `radius` km, from a coarse grid so 1,500 gauges stay quick.
function neighbourFinder(points, radius) {
  const cell = radius / 111;
  const grid = new Map();
  points.forEach((p, i) => {
    const k = `${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  });
  return (i) => {
    const [la, lo] = points[i];
    const cx = Math.floor(la / cell);
    const cy = Math.floor(lo / cell);
    const out = [];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const j of grid.get(`${cx + dx},${cy + dy}`) || []) {
          if (j !== i && km(points[i], points[j]) <= radius) out.push(j);
        }
    return out;
  };
}

// ---- TN-SMART gauges ----

/**
 * rows: TN-SMART hourly rows. Returns Map(gaugeKey -> { level: "bad"|"odd", why: [text] }).
 * Gauges that sent nothing (total null) are offline, not flagged.
 */
export function gaugeFlags(rows) {
  const flags = new Map();
  if (!rows.length) return flags;
  const hours = Object.keys(rows[0]).filter((k) => HOUR_RE.test(k));
  const add = (r, level, why) => {
    const k = gaugeKey(r);
    const f = flags.get(k) || { level: "odd", why: [] };
    if (level === "bad") f.level = "bad";
    f.why.push(why);
    flags.set(k, f);
  };
  for (const r of rows) {
    if (typeof r.total !== "number") continue;
    const v = hours.map((h) => r[h]);
    const nums = v.filter((x) => typeof x === "number");
    if (r.total < 0 || nums.some((x) => x < 0)) add(r, "bad", "a negative reading");
    const big = Math.max(0, ...nums);
    if (big > 150) add(r, "bad", `${r1(big)} mm in one hour`);
    if (r.total > 600) add(r, "bad", `${r1(r.total)} mm in a day`);
    const s = nums.reduce((a, b) => a + b, 0);
    if (nums.length && Math.abs(s - r.total) > Math.max(2, r.total * 0.1)) add(r, "bad", `day total ${r1(r.total)} mm but its hours add to ${r1(s)} mm`);
    // The same rain hour after hour (a stuck tipping bucket or logger).
    let run = 1;
    for (let i = 1; i < v.length; i++) {
      run = typeof v[i] === "number" && v[i] > 0 && v[i] === v[i - 1] ? run + 1 : 1;
      if (run === 6) {
        add(r, "odd", `${r1(v[i])} mm every hour for 6 hours or more`);
        break;
      }
    }
  }
  // Against the neighbours within 10 km.
  const on = rows.filter((r) => typeof r.total === "number" && typeof r.latitude === "number");
  const near = neighbourFinder(on.map((r) => [r.latitude, r.longitude]), 10);
  on.forEach((r, i) => {
    const ns = near(i).map((j) => on[j].total);
    if (ns.length < 3) return;
    const med = median(ns);
    const top = Math.max(...ns);
    if (r.total >= 50 && top < r.total * 0.25 && med < r.total * 0.1)
      add(r, "odd", `${r1(r.total)} mm while the ${ns.length} gauges within 10 km had at most ${r1(top)} mm`);
    if (r.total === 0 && med >= 20 && ns.filter((x) => x >= 10).length >= 3)
      add(r, "odd", `dry while the gauges within 10 km had ${r1(med)} mm (median); blocked funnel?`);
  });
  return flags;
}

// ---- Wunderground stations ----

/**
 * readings: Map(id -> observation | null | Error); coords: { id: [lat, lon] }.
 * Returns Map(id -> { level, why: [text], offline? }).
 */
export function pwsFlags(readings, coords = {}, now = Date.now()) {
  const flags = new Map();
  const add = (id, level, why, extra = {}) => {
    const f = flags.get(id) || { level: "odd", why: [] };
    if (level === "bad") f.level = "bad";
    if (level === "offline") f.level = "offline";
    f.why.push(why);
    Object.assign(f, extra);
    flags.set(id, f);
  };
  const live = [];
  for (const [id, r] of readings) {
    if (r instanceof Error) continue;
    if (!r) {
      add(id, "offline", "no reading in the last hours", { offline: true });
      continue;
    }
    const m = r.metric || {};
    const age = (now - r.epoch * 1000) / 60000;
    if (age > 60) add(id, "offline", `last reading ${age > 120 ? `${Math.round(age / 60)} hours` : `${Math.round(age)} min`} ago`, { offline: true });
    if (typeof m.temp === "number" && (m.temp < 5 || m.temp > 48)) add(id, "bad", `temperature ${r1(m.temp)}°`);
    if (typeof r.humidity === "number" && (r.humidity <= 1 || r.humidity > 100)) add(id, "bad", `humidity ${Math.round(r.humidity)}%`);
    if (typeof m.dewpt === "number" && typeof m.temp === "number" && m.dewpt > m.temp + 1) add(id, "bad", "dew point above the temperature");
    if (typeof m.precipTotal === "number" && (m.precipTotal < 0 || m.precipTotal > 600)) add(id, "bad", `rain today ${r1(m.precipTotal)} mm`);
    if (typeof m.precipRate === "number" && m.precipRate > 250) add(id, "bad", `rain rate ${r1(m.precipRate)} mm/h`);
    if (typeof m.precipRate === "number" && m.precipRate >= 2 && m.precipTotal === 0) add(id, "odd", "raining now but 0 mm today");
    const pos = typeof r.lat === "number" ? [r.lat, r.lon] : coords[id];
    if (pos && age <= 60) live.push({ id, pos, temp: m.temp, rain: m.precipTotal });
  }
  // Against the neighbours: temperature within 25 km, rain within 10 km.
  for (const s of live) {
    const temps = live.filter((o) => o !== s && typeof o.temp === "number" && km(s.pos, o.pos) <= 25).map((o) => o.temp);
    if (typeof s.temp === "number" && temps.length >= 3) {
      const med = median(temps);
      if (Math.abs(s.temp - med) > 4) add(s.id, "odd", `${r1(s.temp)}° while stations around read ${r1(med)}° (median); sensor in the sun or near a wall?`);
    }
    const rains = live.filter((o) => o !== s && typeof o.rain === "number" && km(s.pos, o.pos) <= 10).map((o) => o.rain);
    if (typeof s.rain === "number" && rains.length >= 3) {
      const med = median(rains);
      if (s.rain >= 30 && Math.max(...rains) < s.rain * 0.25) add(s.id, "odd", `${r1(s.rain)} mm today while stations within 10 km had at most ${r1(Math.max(...rains))} mm`);
      if (s.rain === 0 && med >= 20) add(s.id, "odd", `0 mm today while stations within 10 km had ${r1(med)} mm (median); blocked gauge?`);
    }
  }
  return flags;
}

/** True when a flag should keep a reading off maps and averages. */
export const isSuspect = (f) => !!f && (f.level === "bad" || f.level === "odd");

// ---- Screen ----

const $ = (id) => document.getElementById(id);
let loadedAt = 0;
let busy = false;

function item(icon, title, detail, href, level) {
  const li = document.createElement("li");
  li.className = `health-item health-${level}`;
  const a = document.createElement(href ? "a" : "div");
  if (href) a.href = href;
  a.innerHTML = `<span class="near-icon" aria-hidden="true"></span><span class="near-text"><b></b><small></small></span>`;
  a.querySelector(".near-icon").textContent = icon;
  a.querySelector("b").textContent = title;
  a.querySelector("small").textContent = detail;
  li.append(a);
  return li;
}

async function checkPws() {
  const list = $("health-pws");
  const head = $("health-pws-head");
  const key = apiKey();
  if (!key) {
    head.textContent = "Wunderground stations";
    list.replaceChildren(item("🔑", "No API key", "Add it under Wunderground → Manage stations.", "#wunderground", "odd"));
    return;
  }
  list.replaceChildren(item("⏳", "Reading your stations…", "", "", "ok"));
  const { fresh, reached, keyError } = await fetchAll(key);
  if (!reached || keyError) {
    list.replaceChildren(item("⚠️", keyError ? "The API key wasn't accepted" : "Couldn't reach Wunderground", "", "#wunderground", "bad"));
    return;
  }
  const stations = loadStations();
  const names = new Map();
  for (const s of stations) names.set(s.id, names.has(s.id) ? `${names.get(s.id)} / ${s.name}` : s.name);
  const flags = pwsFlags(fresh, loadCoords());
  const offline = [...flags.values()].filter((f) => f.level === "offline").length;
  const odd = [...flags.values()].filter(isSuspect).length;
  head.textContent = `Wunderground stations · ${names.size - offline} of ${names.size} reporting, ${odd} suspect`;
  const rows = [...flags]
    .sort((a, b) => ["bad", "odd", "offline"].indexOf(a[1].level) - ["bad", "odd", "offline"].indexOf(b[1].level))
    .map(([id, f]) =>
      item(
        f.level === "offline" ? "📴" : f.level === "bad" ? "⛔" : "❓",
        `${names.get(id) || id}`,
        `${f.level === "offline" ? "Offline" : f.level === "bad" ? "Wrong reading" : "Odd reading"}: ${f.why.join("; ")} · ${id}`,
        `#wunderground?id=${encodeURIComponent(id)}`,
        f.level
      )
    );
  list.replaceChildren(...(rows.length ? rows : [item("✅", "All stations look fine", "Reporting, and in line with their neighbours.", "", "ok")]));
}

async function checkGauges() {
  const list = $("health-gauges");
  const head = $("health-gauges-head");
  const dist = $("health-districts");
  list.replaceChildren(item("⏳", "Reading the TN-SMART gauges (0.7 MB)…", "", "", "ok"));
  let day = currentRainDay();
  let rows = null;
  try {
    for (let k = 0; k < 2 && !rows; k++) {
      const res = await fetch(`${BASE}hourly_rainfall_${day}.json?t=${Date.now()}`, { cache: "no-store" });
      if (res.ok) rows = await res.json();
      else if (res.status === 404) day = shiftDay(day, -1);
      else throw new Error(`HTTP ${res.status}`);
    }
    if (!rows) throw new Error("no file for today yet");
  } catch (e) {
    list.replaceChildren(item("⚠️", "Couldn't read the gauges", e.message, "#gauges", "bad"));
    return;
  }
  rows = rows.filter((r) => typeof r.latitude === "number");
  const flags = gaugeFlags(rows);
  const offline = rows.filter((r) => typeof r.total !== "number");
  head.textContent = `TN rain gauges · rain day to ${niceDay(day)} · ${rows.length - offline.length} of ${rows.length} reporting, ${flags.size} suspect`;
  const flagged = rows
    .filter((r) => flags.has(gaugeKey(r)))
    .sort((a, b) => (flags.get(gaugeKey(a)).level === "bad" ? -1 : 0) - (flags.get(gaugeKey(b)).level === "bad" ? -1 : 0) || b.total - a.total);
  list.replaceChildren(
    ...(flagged.length
      ? flagged.map((r) => {
          const f = flags.get(gaugeKey(r));
          return item(
            f.level === "bad" ? "⛔" : "❓",
            `${r.station_name} · ${r.total} mm`,
            `${r.district_name} · ${f.why.join("; ")}`,
            `#gauges?gauge=${encodeURIComponent(gaugeKey(r))}`,
            f.level
          );
        })
      : [item("✅", "No suspect gauges", "Every reporting gauge is in line with its neighbours.", "", "ok")])
  );
  // Offline gauges by district.
  const by = new Map();
  for (const r of rows) {
    const d = by.get(r.district_name) || { n: 0, off: 0 };
    d.n++;
    if (typeof r.total !== "number") d.off++;
    by.set(r.district_name, d);
  }
  const body = dist.tBodies[0];
  body.replaceChildren(
    ...[...by]
      .sort((a, b) => b[1].off / b[1].n - a[1].off / a[1].n)
      .map(([name, d]) => {
        const tr = document.createElement("tr");
        for (const [k, t] of [name, `${d.n - d.off} of ${d.n}`, `${d.off}`, `${Math.round((d.off / d.n) * 100)}%`].entries()) {
          const td = document.createElement(k ? "td" : "th");
          if (!k) td.scope = "row";
          td.textContent = t;
          tr.append(td);
        }
        return tr;
      })
  );
}

async function refresh() {
  if (busy) return;
  busy = true;
  const status = $("health-status");
  status.textContent = "Checking…";
  status.className = "status";
  try {
    await Promise.all([checkPws(), checkGauges()]);
    loadedAt = Date.now();
    status.textContent = `Checked ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  } finally {
    busy = false;
  }
}

export function initHealth() {
  const skip = $("health-skip");
  skip.checked = skipSuspects();
  skip.addEventListener("change", () => setSkipSuspects(skip.checked));
  $("health-refresh").addEventListener("click", refresh);
}

export function showHealth() {
  $("health-skip").checked = skipSuspects();
  if (Date.now() - loadedAt > 5 * 60 * 1000) refresh();
}
