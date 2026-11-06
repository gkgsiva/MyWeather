// Compare stations (#compare): two or three Wunderground stations' rain side
// by side, as running totals through one day or through one month.
//
//   #compare?ids=ICHENN47,ICHENNAI1&day=2026-11-05
//   #compare?ids=ICHENN47,ICHENNAI1,ITAMBA20&month=2026-11
//
// A day uses every reading the stations sent that day (history/all, or
// observations/all/1day for today): one request per station. A month uses the
// daily totals kept on the phone by Rain history, fetching only the days
// still missing (one request per day, spaced out for the key's limits).
import { loadStations, apiKey } from "./wunderground.js";
import { routeParams } from "./route.js";
import { drawLines } from "./chart.js";
import {
  get,
  KeyError,
  rainOn,
  fetch7Days,
  loadDays,
  dayKey,
  todayKey,
  monthKey,
  parseMonth,
  addMonths,
  daysIn,
  monthDays,
  monthName,
  MONTHS,
} from "./rain.js";

const SLOT_MIN = 10; // a day is drawn in 10-minute steps
const SLOTS = (24 * 60) / SLOT_MIN;

const $ = (id) => document.getElementById(id);
const picks = [$("cmp-s1"), $("cmp-s2"), $("cmp-s3")];
const modePick = $("cmp-mode");
const dayInput = $("cmp-day");
const monthNav = $("cmp-month-nav");
const status = $("cmp-status");
const chart = $("cmp-chart");
const readout = $("cmp-readout");
const totals = $("cmp-totals");

let stations = [];
let run = 0;
const daySeries = new Map(); // "ID|YYYY-MM-DD" -> { slots: [mm|null], total, peakRate } (past days only)

function say(text, error = false) {
  status.textContent = text;
  status.className = error ? "status error" : "status";
}

const fmt = (v) => (typeof v === "number" ? v.toFixed(1) : "–");
const name = (id) => stations.find((s) => s.id === id)?.name || id;

// ---- Route ----

function state() {
  const p = routeParams();
  const ids = (p.get("ids") || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 3);
  const month = parseMonth(p.get("month"));
  const day = /^\d{4}-\d{2}-\d{2}$/.test(p.get("day") || "") ? p.get("day") : "";
  return { ids, month, day: month ? "" : day || todayKey() };
}

function go(next) {
  const cur = state();
  const s = { ...cur, ...next };
  const qs = new URLSearchParams({ ids: s.ids.join(",") });
  if (s.month) qs.set("month", monthKey(s.month));
  else qs.set("day", s.day);
  location.hash = `#compare?${qs.toString().replace(/%2C/g, ",")}`;
}

// ---- One day: running total through the day ----

function toSlots(observations) {
  const slots = Array(SLOTS).fill(null);
  let peakRate = null;
  let total = null;
  for (const o of observations || []) {
    const t = (o.obsTimeLocal || "").slice(11, 16);
    const mm = o.metric?.precipTotal;
    if (!t || typeof mm !== "number") continue;
    const i = Math.min(SLOTS - 1, Math.floor((Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))) / SLOT_MIN));
    slots[i] = Math.max(slots[i] ?? 0, mm);
    total = Math.max(total ?? 0, mm);
    const rate = o.metric?.precipRate;
    if (typeof rate === "number") peakRate = Math.max(peakRate ?? 0, rate);
  }
  // Running total never goes down; carry it across slots with no reading.
  let last = null;
  for (let i = 0; i < SLOTS; i++) {
    if (slots[i] !== null) last = Math.max(last ?? 0, slots[i]);
    slots[i] = last;
  }
  return { slots, total, peakRate };
}

async function fetchDaySeries(id, day) {
  const key = `${id}|${day}`;
  if (daySeries.has(key)) return daySeries.get(key);
  const body =
    day === todayKey()
      ? await get("observations/all/1day", { stationId: id })
      : await get("history/all", { stationId: id, date: day.replaceAll("-", "") });
  const s = toSlots(body?.observations);
  if (day !== todayKey()) daySeries.set(key, s);
  return s;
}

function drawDay(ids, day, data) {
  const isToday = day === todayKey();
  const nowSlot = isToday ? Math.floor((new Date().getHours() * 60 + new Date().getMinutes()) / SLOT_MIN) : SLOTS;
  const series = ids.map((id, n) => ({
    cls: `s${n + 1}`,
    values: (data[id]?.slots || []).map((v, i) => (i <= nowSlot ? v : null)),
  }));
  const ticks = [0, 6, 12, 18].map((h) => ({ at: (h * 60) / SLOT_MIN, label: h === 0 ? "0h" : String(h) }));
  ticks.push({ at: SLOTS - 1, label: "24" });
  const points = [];
  for (let i = 0; i < SLOTS; i += 3) {
    const t = `${String(Math.floor((i * SLOT_MIN) / 60)).padStart(2, "0")}:${String((i * SLOT_MIN) % 60).padStart(2, "0")}`;
    points.push({
      at: i,
      text: `By ${t}: ` + ids.map((id) => `${name(id)} ${fmt(data[id]?.slots?.[i])}`).join(" · ") + " mm",
    });
  }
  const d = new Date(`${day}T00:00`);
  drawLines(chart, readout, { count: SLOTS, series, ticks, points }, `Rain so far through ${d.getDate()} ${MONTHS[d.getMonth()]}. Tap the chart for a time.`, {
    unit: "mm",
  });
  renderTotals(
    ids,
    ids.map((id) => [fmt(data[id]?.total), typeof data[id]?.peakRate === "number" ? `${fmt(data[id].peakRate)} mm/h` : "–"]),
    ["Day total", "Peak rate"]
  );
}

// ---- One month: running total of daily rain ----

function drawMonth(ids, m) {
  const n = daysIn(m);
  const keys = monthDays(m);
  const series = ids.map((id, s) => {
    let sum = 0;
    return {
      cls: `s${s + 1}`,
      values: Array.from({ length: n }, (_, i) => {
        const k = dayKey(new Date(m.getFullYear(), m.getMonth(), i + 1));
        if (!keys.includes(k)) return null;
        const v = rainOn(id, k);
        if (v === undefined) return null;
        sum += v || 0;
        return sum;
      }),
    };
  });
  const ticks = [1, 5, 10, 15, 20, 25, n].map((d) => ({ at: d - 1, label: String(d) }));
  const points = Array.from({ length: n }, (_, i) => {
    const k = dayKey(new Date(m.getFullYear(), m.getMonth(), i + 1));
    const label = `${i + 1} ${MONTHS[m.getMonth()]}`;
    if (!keys.includes(k)) return { at: i, text: `${label}: not yet` };
    return {
      at: i,
      text:
        `${label}: ` +
        ids
          .map((id) => {
            const v = rainOn(id, k);
            return `${name(id)} ${v === undefined ? "…" : fmt(v)}`;
          })
          .join(" · ") +
        " mm that day",
    };
  });
  drawLines(chart, readout, { count: n, series, ticks, points }, `Running total for ${monthName(m)}. Tap the chart for a day.`, {
    unit: "mm",
  });
  renderTotals(
    ids,
    ids.map((id) => {
      const vals = keys.map((k) => rainOn(id, k));
      const known = vals.filter((v) => v !== undefined);
      const total = known.reduce((t, v) => t + (v || 0), 0);
      const wettest = Math.max(0, ...known.map((v) => v || 0));
      return [
        known.length ? `${fmt(total)}${known.length < keys.length ? ` (${known.length}/${keys.length} days)` : ""}` : "…",
        known.length ? fmt(wettest) : "–",
      ];
    }),
    ["Month total", "Wettest day"]
  );
}

function renderTotals(ids, rows, heads) {
  const thead = totals.querySelector("thead tr");
  thead.replaceChildren(
    ...["Station", ...heads].map((h, i) => {
      const th = document.createElement("th");
      th.scope = "col";
      th.innerHTML = i === 0 || h === "Peak rate" ? h : `${h}<br><small>mm</small>`;
      return th;
    })
  );
  totals.querySelector("tbody").replaceChildren(
    ...ids.map((id, n) => {
      const tr = document.createElement("tr");
      const th = document.createElement("th");
      th.scope = "row";
      th.innerHTML = `<span class="swatch s${n + 1}"></span>`;
      th.append(name(id));
      tr.append(th, ...rows[n].map((v) => Object.assign(document.createElement("td"), { textContent: v })));
      tr.addEventListener("click", () => (location.hash = `#rain?id=${encodeURIComponent(id)}`));
      return tr;
    })
  );
}

// ---- Screen ----

function renderControls(s) {
  const opts = (blank) => [
    ...(blank ? [new Option(blank, "")] : []),
    ...stations.map((x) => new Option(`${x.name} (${x.id})`, x.id)),
  ];
  picks.forEach((p, i) => {
    p.replaceChildren(...opts(i === 2 ? "— none —" : i === 1 && !stations.length ? "—" : ""));
    p.value = s.ids[i] || (i === 2 ? "" : stations[i]?.id || "");
  });
  modePick.value = s.month ? "month" : "day";
  dayInput.closest("label").hidden = !!s.month;
  monthNav.hidden = !s.month;
  dayInput.max = todayKey();
  if (!s.month) dayInput.value = s.day;
  else {
    const thisMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    $("cmp-month-label").textContent = monthName(s.month);
    $("cmp-next").disabled = s.month >= thisMonth;
  }
}

async function show() {
  const myRun = ++run;
  stations = loadStations();
  let s = state();
  if (s.ids.length < 2) {
    // Start with the first two saved stations.
    const ids = [...new Set([...s.ids, ...stations.map((x) => x.id)])].slice(0, 2);
    if (ids.length === 2) return go({ ids });
  }
  renderControls(s);
  const ids = [...new Set(s.ids)];
  if (ids.length < 2) {
    say("Pick two or three different stations.", true);
    return;
  }
  if (!apiKey()) {
    say("Add your Wunderground API key under Wunderground → Manage stations to compare stations.", true);
    return;
  }

  if (!s.month) {
    const data = {};
    drawDay(ids, s.day, data);
    say("Loading the day's readings…");
    let keyError = false;
    let failed = 0;
    await Promise.all(
      ids.map(async (id) => {
        try {
          data[id] = await fetchDaySeries(id, s.day);
        } catch (e) {
          if (e instanceof KeyError) keyError = true;
          failed++;
        }
        if (myRun === run) drawDay(ids, s.day, data);
      })
    );
    if (myRun !== run) return;
    if (keyError) return say("Wunderground didn't accept the API key. Check it under Wunderground → Manage stations.", true);
    say(
      failed === ids.length
        ? "Couldn't reach Wunderground. Try again in a moment."
        : `Updated ${new Date().toLocaleTimeString()}${failed ? ` · ${failed} station(s) didn't answer` : ""}`,
      failed === ids.length
    );
    return;
  }

  const m = s.month;
  drawMonth(ids, m);
  const cancelled = () => myRun !== run;
  say("Loading daily totals…");
  for (const id of ids) {
    try {
      // Covers the last week in one request.
      if (monthKey(m) === monthKey(new Date()) || monthKey(m) === monthKey(addMonths(new Date(), -1))) await fetch7Days(id);
    } catch (e) {
      if (e instanceof KeyError) return say("Wunderground didn't accept the API key. Check it under Wunderground → Manage stations.", true);
    }
    if (cancelled()) return;
    drawMonth(ids, m);
  }
  for (const id of ids) {
    const reason = await loadDays(
      id,
      monthDays(m),
      cancelled,
      (left) => {
        drawMonth(ids, m);
        say(`Loading ${name(id)}… ${left} days to go.`);
      },
      () => say("Wunderground's per-minute limit was reached; carrying on in a minute…"),
      true // oldest first, so the running total grows from the 1st
    );
    if (reason === "cancelled") return;
    if (reason === "key") return say("Wunderground didn't accept the API key. Check it under Wunderground → Manage stations.", true);
    if (reason === "network") return say("Couldn't reach Wunderground. Days loaded so far are kept; try again.", true);
  }
  drawMonth(ids, m);
  say(`Updated ${new Date().toLocaleTimeString()}. Finished days are kept on the phone.`);
}

export function initCompare() {
  const pickIds = () => picks.map((p) => p.value).filter(Boolean);
  for (const p of picks) p.addEventListener("change", () => go({ ids: pickIds() }));
  modePick.addEventListener("change", () => {
    if (modePick.value === "month") go({ month: new Date(new Date().getFullYear(), new Date().getMonth(), 1) });
    else go({ month: null, day: todayKey() });
  });
  dayInput.addEventListener("change", () => dayInput.value && go({ day: dayInput.value > todayKey() ? todayKey() : dayInput.value }));
  $("cmp-prev").addEventListener("click", () => go({ month: addMonths(state().month, -1) }));
  $("cmp-next").addEventListener("click", () => go({ month: addMonths(state().month, 1) }));
  $("cmp-refresh").addEventListener("click", () => {
    const s = state();
    if (!s.month) for (const id of s.ids) daySeries.delete(`${id}|${s.day}`);
    show();
  });
}

export function showCompare() {
  show();
}

// Leaving the screen stops the request queue.
export function hideCompare() {
  run++;
}
