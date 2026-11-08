// Rain records (#records): a district's wettest days, spells, months and
// hours since TN-SMART began publishing district means (11 Oct 2025).
//
// Days: TN-SMART's daily district mean (srg_arg/mean_rainfall_district_<day>.json,
// about 7 KB a day, rain day to 8:30 AM IST). Finished days are kept on the
// phone, so only new days are downloaded after the first time (about 3 MB).
// Spells: runs of days with a district mean of 2.5 mm or more (IMD's rainy
// day), ranked by their total; each opens on the Rain spell screen.
// Hours: the wettest single hour at any of the district's gauges on its 6
// wettest days (TN-SMART hourly files, about 0.7 MB each, so this is a button);
// gauges Station health finds suspect that day are left out.
import { currentRainDay, shiftDay, niceDay, BASE, gaugeKey } from "./gaugedays.js";
import { gaugeFlags, skipSuspects, isSuspect } from "./health.js";
import { idbGet, idbPut } from "./idb.js";
import { drawBars } from "./chart.js";
import { TN_DISTRICTS } from "./districts.js";

const MEANS = "https://beta-tnsmart.rimes.int/Rainfall_Python_IDW/srg_arg/mean_rainfall_district_";
const FIRST_DAY = "2025-10-11";
const AREA_KEY = "myweather.records.area";
const HOURS_KEY = "myweather.records.hours";
const RAINY = 2.5;

const $ = (id) => document.getElementById(id);
const norm = (s) => String(s).toLowerCase().replace(/[^a-z]/g, "");
const fmt = (v) => (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10).toString();

let means = null; // { day: { district: mm } | 0 }
let run = 0;

function say(text, error = false) {
  const s = $("rec-status");
  s.textContent = text;
  s.className = error ? "status error" : "status";
}

async function fetchMeans(day) {
  const running = day >= currentRainDay();
  const res = await fetch(`${MEANS}${day}.json${running ? `?t=${Date.now()}` : ""}`, { cache: running ? "no-store" : "default" });
  if (res.status === 404) return 0;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const out = {};
  for (const r of await res.json()) {
    const d = TN_DISTRICTS.find(([n]) => norm(n) === norm(r.district_name));
    if (d && typeof r.mean_rainfall === "number") out[d[0]] = r.mean_rainfall;
  }
  return out;
}

async function loadMeans(onProgress) {
  means = means || (await idbGet("misc", "records.means")) || {};
  const today = currentRainDay();
  const want = [];
  for (let d = FIRST_DAY; d <= today; d = shiftDay(d, 1)) {
    // Missing or running days, and a recent empty day (it may only be late).
    if (!(d in means) || d >= shiftDay(today, -1) || (means[d] === 0 && d >= shiftDay(today, -3))) want.push(d);
  }
  let done = 0;
  const queue = [...want];
  const worker = async () => {
    while (queue.length) {
      const d = queue.shift();
      try {
        means[d] = await fetchMeans(d);
      } catch {
        // leave it for next time
      }
      onProgress(++done, want.length);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  // Keep finished days only.
  const keep = {};
  for (const [d, v] of Object.entries(means)) if (d < today) keep[d] = v;
  idbPut("misc", "records.means", keep);
  return means;
}

function seriesOf(area) {
  return Object.keys(means)
    .sort()
    .map((day) => ({ day, mm: means[day] ? means[day][area] : undefined }))
    .filter((x) => typeof x.mm === "number");
}

function spells(series) {
  const out = [];
  let cur = null;
  for (const x of series) {
    const next = cur && shiftDay(cur.to, 1) === x.day;
    if (x.mm >= RAINY && next) {
      cur.to = x.day;
      cur.total += x.mm;
      cur.days++;
    } else if (x.mm >= RAINY) {
      if (cur) out.push(cur);
      cur = { from: x.day, to: x.day, total: x.mm, days: 1 };
    } else if (cur) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out.sort((a, b) => b.total - a.total);
}

const spellLink = (area, from, to) => `#spell?${new URLSearchParams({ area, from, to })}`;
const span = (a, b) =>
  a === b
    ? niceDay(a, { year: "numeric" })
    : `${niceDay(a, a.slice(0, 4) === b.slice(0, 4) ? {} : { year: "numeric" })} – ${niceDay(b, { year: "numeric" })}`;

function rankList(box, items) {
  const top = Math.max(1, ...items.map((i) => i.value));
  box.replaceChildren(
    ...items.map((it, k) => {
      const li = document.createElement("li");
      const row = document.createElement(it.href ? "a" : "div");
      row.className = "rank-row rec-row";
      if (it.href) row.href = it.href;
      row.innerHTML = '<span class="rank-name"></span><span class="rank-val"></span><span class="rank-bar"><i></i></span>';
      row.querySelector(".rank-name").textContent = `${k + 1}. ${it.label}`;
      row.querySelector(".rank-val").textContent = it.val;
      const bar = row.querySelector("i");
      bar.style.width = `${(it.value / top) * 100}%`;
      bar.style.background = "#1e88e5";
      li.append(row);
      return li;
    })
  );
}

function render(area) {
  const series = seriesOf(area);
  if (!series.length) {
    say(`No district figures for ${area} yet.`, true);
    return;
  }
  const first = series[0].day;
  const last = series[series.length - 1].day;
  $("rec-span").textContent = `${area} · ${span(first, last)} · ${series.length} days`;
  const total = series.reduce((a, x) => a + x.mm, 0);
  const rainy = series.filter((x) => x.mm >= RAINY).length;
  $("rec-summary").textContent = `${fmt(total)} mm in all, on ${rainy} rainy days (2.5 mm or more, district mean).`;

  const days = [...series].sort((a, b) => b.mm - a.mm).slice(0, 10);
  rankList(
    $("rec-days"),
    days.map((x) => ({ label: niceDay(x.day, { year: "numeric", weekday: "short" }), val: `${fmt(x.mm)} mm`, value: x.mm, href: spellLink(area, x.day, x.day) }))
  );

  const sp = spells(series).slice(0, 10);
  rankList(
    $("rec-spells"),
    sp.map((s) => ({
      label: `${span(s.from, s.to)} (${s.days} day${s.days > 1 ? "s" : ""})`,
      val: `${fmt(s.total)} mm`,
      value: s.total,
      href: spellLink(area, s.from, s.days > 31 ? shiftDay(s.from, 30) : s.to),
    }))
  );

  // Months.
  const months = new Map();
  for (const x of series) months.set(x.day.slice(0, 7), (months.get(x.day.slice(0, 7)) || 0) + x.mm);
  const keys = [...months.keys()].sort();
  drawBars(
    $("rec-months"),
    $("rec-months-readout"),
    keys.map((k) => {
      const d = new Date(`${k}-01T00:00:00Z`);
      const name = d.toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
      return {
        tick: d.toLocaleDateString("en-IN", { month: "narrow", timeZone: "UTC" }),
        value: months.get(k),
        partial: k === last.slice(0, 7),
        text: `${name}: ${fmt(months.get(k))} mm`,
      };
    }),
    "Tap a month."
  );

  showHours(area, days.slice(0, 6));
}

// ---- Wettest hours ----

function savedHours(area) {
  try {
    const all = JSON.parse(localStorage.getItem(HOURS_KEY)) || {};
    return all[area] || null;
  } catch {
    return null;
  }
}

function showHours(area, topDays) {
  const box = $("rec-hours");
  const btn = $("rec-hours-btn");
  const saved = savedHours(area);
  const key = topDays.map((d) => d.day).join(",");
  btn.hidden = !!(saved && saved.key === key);
  btn.textContent = `Find the wettest hours (about ${(topDays.length * 0.7).toFixed(1)} MB)`;
  btn.onclick = () => findHours(area, topDays);
  if (saved && saved.key === key) drawHours(saved.list);
  else box.replaceChildren();
}

function drawHours(list) {
  rankList(
    $("rec-hours"),
    list.map((h) => ({ label: `${h.gauge}, ${h.when}`, val: `${fmt(h.mm)} mm`, value: h.mm }))
  );
}

async function findHours(area, topDays) {
  const btn = $("rec-hours-btn");
  btn.disabled = true;
  const found = [];
  try {
    for (let i = 0; i < topDays.length; i++) {
      const day = topDays[i].day;
      btn.textContent = `Reading ${niceDay(day)} (${i + 1} of ${topDays.length})…`;
      const res = await fetch(`${BASE}hourly_rainfall_${day}.json`);
      if (!res.ok) continue;
      const all = await res.json();
      // Leave out gauges Station health finds suspect that day.
      const flags = skipSuspects() ? gaugeFlags(all) : new Map();
      const rows = all.filter((r) => r.district_name === area && !isSuspect(flags.get(gaugeKey(r))));
      if (!rows.length) continue;
      const cols = Object.keys(rows[0]).filter((k) => /^\d\d:\d\d [AP]M$/.test(k));
      const start = Date.parse(`${shiftDay(day, -1)}T08:30:00+05:30`);
      for (const r of rows)
        cols.forEach((c, k) => {
          const v = r[c];
          if (typeof v === "number" && v > 0) found.push({ gauge: r.station_name, mm: v, end: start + (k + 1) * 3600 * 1000 });
        });
    }
    found.sort((a, b) => b.mm - a.mm);
    const t = (ms) => new Date(ms).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
    const list = found.slice(0, 10).map((h) => ({
      gauge: h.gauge,
      mm: h.mm,
      when: `${new Date(h.end - 3600 * 1000).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })}, ${t(h.end - 3600 * 1000)}–${t(h.end)}`,
    }));
    try {
      const all = JSON.parse(localStorage.getItem(HOURS_KEY)) || {};
      all[area] = { key: topDays.map((d) => d.day).join(","), list };
      localStorage.setItem(HOURS_KEY, JSON.stringify(all));
    } catch {}
    drawHours(list);
    btn.hidden = true;
  } catch (e) {
    btn.textContent = `Couldn't read the gauges (${e.message}). Try again`;
  } finally {
    btn.disabled = false;
  }
}

async function load() {
  const me = ++run;
  const area = $("rec-area").value;
  say(means ? "Checking for new days…" : "Loading the district figures…");
  try {
    await loadMeans((done, total) => me === run && say(`Downloading district figures… ${done} of ${total} days`));
    if (me !== run) return;
    say("");
    render(area);
  } catch (e) {
    if (me !== run) return;
    say(`Couldn't load the district figures (${e.message}).`, true);
  }
}

export function initRecords() {
  const pick = $("rec-area");
  pick.replaceChildren(...TN_DISTRICTS.map(([n]) => new Option(n, n)));
  try {
    const a = localStorage.getItem(AREA_KEY);
    pick.value = TN_DISTRICTS.some(([n]) => n === a) ? a : "Chennai";
  } catch {
    pick.value = "Chennai";
  }
  pick.addEventListener("change", () => {
    try {
      localStorage.setItem(AREA_KEY, pick.value);
    } catch {}
    if (means) render(pick.value);
    else load();
  });
  $("rec-refresh").addEventListener("click", load);
}

let shownAt = 0;
export function showRecords() {
  if (means && Date.now() - shownAt < 30 * 60 * 1000) return;
  shownAt = Date.now();
  load();
}
