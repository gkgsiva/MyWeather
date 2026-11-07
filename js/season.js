// Rain season (#season): every saved station's total rain since 1 October
// (the northeast monsoon season), wettest first. From January to September
// it shows the last season (1 October to 31 December).
//
// Uses the daily totals Rain history keeps on the phone (js/rain.js). Opening
// the screen asks only for the last 7 days (one request per station); the rest
// of the season is loaded with "Load the whole season", one request per
// station-day, oldest first, spaced out like Rain history. Each finished day
// is fetched once and kept.
import { loadStations, apiKey } from "./wunderground.js";
import { dayKey, todayKey, MONTHS, rainOn, fetch7Days, loadDays, KeyError } from "./rain.js";

const GAP_MS = 2100;
const TTL = 10 * 60 * 1000;
const RAINY_MM = 2.5; // IMD's "rainy day"

const $ = (id) => document.getElementById(id);
const heading = $("season-heading");
const status = $("season-status");
const list = $("season-list");
const summary = $("season-summary");
const loadBtn = $("season-load");
const loadNote = $("season-load-note");

let run = 0;
let loadedAt = 0;
let loading = false;

// Season start and end for a date: 1 Oct to 31 Dec, this year from October.
export function seasonFor(date = new Date()) {
  const y = date.getMonth() >= 9 ? date.getFullYear() : date.getFullYear() - 1;
  return { start: new Date(y, 9, 1), end: new Date(y, 11, 31), year: y };
}

// "YYYY-MM-DD" for every day of the season up to today.
export function seasonDays(date = new Date()) {
  const { start, end } = seasonFor(date);
  const last = todayKey();
  const out = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const k = dayKey(d);
    if (k > last) break;
    out.push(k);
  }
  return out;
}

const label = (k) => {
  const [, m, d] = k.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
};

// Totals for one station: { total, known, rainy, wettest: [key, mm] }.
export function stationSeason(id, days, rainFor = rainOn) {
  let total = 0;
  let known = 0;
  let rainy = 0;
  let wettest = null;
  for (const k of days) {
    const v = rainFor(id, k);
    if (v === undefined) continue;
    known++;
    if (typeof v !== "number") continue;
    total += v;
    if (v >= RAINY_MM) rainy++;
    if (!wettest || v > wettest[1]) wettest = [k, v];
  }
  return { total, known, rainy, wettest };
}

function say(text, error = false) {
  status.textContent = text;
  status.className = error ? "status error" : "status";
}

// Each station once, with all its nicknames.
function uniqueStations() {
  const out = new Map();
  for (const s of loadStations()) {
    if (out.has(s.id)) out.get(s.id).name += ` / ${s.name}`;
    else out.set(s.id, { id: s.id, name: s.name });
  }
  return [...out.values()];
}

function draw() {
  const days = seasonDays();
  const { start, year } = seasonFor();
  const finished = days.length && days[days.length - 1] < todayKey();
  heading.textContent = `${finished ? `Season ${year}` : "This season"}: 1 Oct to ${label(days[days.length - 1] || dayKey(start))} · ${days.length} days`;
  const rows = uniqueStations()
    .map((s) => ({ ...s, ...stationSeason(s.id, days) }))
    .sort((a, b) => b.total - a.total || b.known - a.known);
  const max = Math.max(1, ...rows.map((r) => r.total));
  let missing = 0;
  list.replaceChildren(
    ...rows.map((r, i) => {
      missing += days.length - r.known;
      const li = document.createElement("li");
      const partial = r.known < days.length;
      li.className = partial ? "partial" : "";
      li.tabIndex = 0;
      const open = () => (location.hash = `#rain?id=${encodeURIComponent(r.id)}`);
      li.addEventListener("click", open);
      li.addEventListener("keydown", (e) => e.key === "Enter" && open());
      li.innerHTML = `<span class="rank"></span><span class="name"></span><b class="mm"></b>
        <span class="meter"><span></span></span><small></small>`;
      li.querySelector(".rank").textContent = r.known ? String(i + 1) : "–";
      li.querySelector(".name").textContent = r.name;
      li.querySelector(".mm").textContent = r.known ? `${r.total.toFixed(1)} mm` : "–";
      li.querySelector(".meter span").style.width = `${(100 * r.total) / max}%`;
      const bits = [];
      if (r.known) bits.push(`${r.rainy} rainy day${r.rainy === 1 ? "" : "s"}`);
      if (r.wettest && r.wettest[1] > 0) bits.push(`wettest ${r.wettest[1].toFixed(1)} mm on ${label(r.wettest[0])}`);
      if (partial) bits.push(`${r.known} of ${days.length} days loaded`);
      li.querySelector("small").textContent = bits.join(" · ") || "Not loaded yet";
      return li;
    })
  );
  const done = rows.filter((r) => r.known === days.length && days.length);
  if (done.length >= 2) {
    const avg = done.reduce((t, r) => t + r.total, 0) / done.length;
    const wet = done[0];
    const dry = done[done.length - 1];
    summary.hidden = false;
    summary.innerHTML = `<span><small>Wettest</small><b></b><em></em></span><span><small>Average</small><b></b><em></em></span><span><small>Driest</small><b></b><em></em></span>`;
    const [a, b, c] = summary.querySelectorAll("span");
    a.querySelector("b").textContent = `${wet.total.toFixed(0)} mm`;
    a.querySelector("em").textContent = wet.name;
    b.querySelector("b").textContent = `${avg.toFixed(0)} mm`;
    b.querySelector("em").textContent = `${done.length} stations`;
    c.querySelector("b").textContent = `${dry.total.toFixed(0)} mm`;
    c.querySelector("em").textContent = dry.name;
  } else summary.hidden = true;

  const mins = Math.ceil((missing * GAP_MS) / 60000);
  loadBtn.hidden = missing === 0;
  loadBtn.disabled = loading;
  loadNote.textContent = missing
    ? `${missing} station-days still to load, about ${mins} minute${mins === 1 ? "" : "s"} (one Wunderground request each, kept on the phone). Keep this screen open while it loads; it carries on where it stopped next time.`
    : "Every day of the season is loaded for every station.";
  return missing;
}

async function loadWeek() {
  const myRun = run;
  const stations = uniqueStations();
  say("Loading the last 7 days for each station…");
  let failed = 0;
  let keyError = false;
  const queue = stations.map((s) => s.id);
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
  if (keyError) return say("Wunderground didn't accept the API key. Check it under Wunderground → Manage stations.", true);
  if (failed === stations.length) return say("Couldn't reach Wunderground. Totals use the days kept on the phone.", true);
  loadedAt = Date.now();
  const missing = draw();
  say(`Updated ${new Date().toLocaleTimeString()}${missing ? ". Totals marked lighter are not complete yet." : ""}`);
}

async function loadSeason() {
  const myRun = ++run;
  loading = true;
  draw();
  const days = seasonDays();
  const stations = uniqueStations();
  let reason = "";
  for (let i = 0; i < stations.length && !reason; i++) {
    const s = stations[i];
    reason = await loadDays(
      s.id,
      days,
      () => myRun !== run,
      (left) => {
        draw();
        say(`Loading ${s.name} (${i + 1} of ${stations.length})… ${left} days to go.`);
      },
      () => say("Wunderground's per-minute limit was reached; carrying on in a minute…"),
      true
    );
    // A station that doesn't answer shouldn't stop the others.
    if (reason === "network") reason = "";
  }
  if (myRun !== run) return;
  loading = false;
  const missing = draw();
  if (reason === "key") say("Wunderground didn't accept the API key. Check it under Wunderground → Manage stations.", true);
  else if (missing) say("Some days couldn't be loaded. Press the button again to retry them.", true);
  else say("The whole season is loaded.");
}

export function initSeason() {
  $("season-refresh").addEventListener("click", () => {
    loadedAt = 0;
    showSeason();
  });
  loadBtn.addEventListener("click", () => {
    if (!apiKey()) return say("Add your Wunderground API key under Wunderground → Manage stations.", true);
    loadSeason();
  });
}

export function showSeason() {
  run++;
  loading = false;
  draw();
  if (!apiKey()) {
    say("Add your Wunderground API key under Wunderground → Manage stations to see season totals.", true);
    return;
  }
  if (Date.now() - loadedAt > TTL) loadWeek();
}

// Leaving the screen stops the loader.
export function hideSeason() {
  run++;
  loading = false;
}
