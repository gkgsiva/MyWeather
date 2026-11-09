// Rainfall cards (#distrank): the rain day's wettest rain gauges as a card to
// share as a picture (like the "24 hours ending 8:30 AM" cards passed around
// on WhatsApp). Three cards: one coloured panel per district you pick, and the
// top places of Tamil Nadu or of KTCC (Chennai, Kancheepuram, Tiruvallur,
// Chengalpattu) with the highest rainfall and the districts with most places.
//
// Data: TN-SMART's hourly gauge file for the rain day (8:30 AM to 8:30 AM
// IST), the same file as TN rain gauges. Gauges Station health finds suspect
// are left out of the ranking unless that is turned off there. TN-SMART only
// carries the automatic gauges, so manual taluk and IMD gauges that appear in
// TNDRRA's own bulletins (e.g. Avadi, Anna University) aren't on the card.
import { BASE, currentRainDay, shiftDay, remember, gaugeKey } from "./gaugedays.js";
import { gaugeFlags, skipSuspects } from "./health.js";
import { TN_DISTRICTS } from "./districts.js";
import { homeDistrict } from "./prefs.js";

const PICK_KEY = "myweather.distrank.districts";
const TOP_KEY = "myweather.distrank.top";
const WIDE_KEY = "myweather.distrank.wide";
const TYPE_KEY = "myweather.distrank.type";
const N_KEY = "myweather.distrank.n";
const KTCC = ["Chennai", "Kancheepuram", "Tiruvallur", "Chengalpattu"];
// One colour per panel, in the order the districts were picked.
const COLOURS = ["#1a6a88", "#6a58a6", "#1a876a", "#b0692f", "#b23a55", "#4f6e1e", "#2f4f9e", "#8a4f8f"];
const HOUR_RE = /^\d\d:\d\d [AP]M$/;
const MAX_PICK = 8;
// Greater Chennai Corporation gauges are named "Z 04 Tondiarpet (W 42)".
const GCC_ZONES = ["Thiruvottiyur", "Manali", "Madhavaram", "Tondiarpet", "Royapuram", "Thiru. Vi. Ka. Nagar", "Ambattur", "Anna Nagar", "Teynampet", "Kodambakkam", "Valasaravakkam", "Alandur", "Adyar", "Perungudi", "Sholinganallur"];
const sourceOf = (name) => (/^Z \d\d\b/.test(name.trim()) ? "GCC" : "TNDRRA");
function zoneOf(name) {
  const m = /^Z (\d\d)\b/.exec(name.trim());
  const z = m && GCC_ZONES[Number(m[1]) - 1];
  return z ? `Zone ${Number(m[1])} ${z}` : "";
}

const $ = (id) => document.getElementById(id);
const read = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const mm = (v) => (Math.round(v * 10) / 10).toFixed(1);
// TN-SMART mixes cases ("pennalur", "Wimco nagar"); capitalise lower-case words.
const tidy = (s) => String(s).trim().replace(/\s+/g, " ").replace(/\b[a-z]/g, (c) => c.toUpperCase());
const longDay = (day) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" });

let picked = [];
const cache = new Map(); // day -> { rows, hours, at }
let shownDay = "";
let userDay = false;
let run = 0;

function say(text, error = false) {
  const s = $("dr-status");
  s.textContent = text;
  s.className = error ? "status error" : "status";
}

function savedPicks() {
  const list = read(PICK_KEY, null);
  if (!Array.isArray(list)) return [...KTCC];
  return list.filter((d) => TN_DISTRICTS.some(([n]) => n === d)).slice(0, MAX_PICK);
}

// ---- District picker ----

function drawPicker() {
  $("dr-pick-count").textContent = picked.length ? picked.join(", ") : "none";
  for (const box of $("dr-pick").querySelectorAll("input")) {
    box.checked = picked.includes(box.value);
    box.disabled = !box.checked && picked.length >= MAX_PICK;
  }
}

function setPicks(list) {
  picked = list.slice(0, MAX_PICK);
  write(PICK_KEY, picked);
  drawPicker();
  draw();
}

// ---- Data ----

async function fetchDay(day) {
  const running = day >= currentRainDay();
  const res = await fetch(`${BASE}hourly_rainfall_${day}.json${running ? `?t=${Date.now()}` : ""}`, {
    cache: running ? "no-store" : "default",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getDay(day, force) {
  const c = cache.get(day);
  const running = day >= currentRainDay();
  if (c && !force && (!running || Date.now() - c.at < 10 * 60 * 1000)) return c;
  const data = await fetchDay(day);
  if (!data) return null;
  remember(day, data);
  const out = { rows: data, hours: Object.keys(data[0] || {}).filter((k) => HOUR_RE.test(k)), flags: gaugeFlags(data), at: Date.now() };
  cache.set(day, out);
  return out;
}

async function load(force = false) {
  const my = ++run;
  // The last finished rain day, unless a day was picked.
  let day = userDay && $("dr-date").value ? $("dr-date").value : shiftDay(currentRainDay(), -1);
  say("Loading the rain gauges…");
  try {
    let d = await getDay(day, force);
    if (!d && !userDay) {
      day = shiftDay(day, -1);
      d = await getDay(day, force);
    }
    if (my !== run) return;
    shownDay = day;
    $("dr-date").value = day;
    if (!d) {
      say(`TN-SMART has no gauge file for the rain day ending ${longDay(day)}.`, true);
      $("dr-card").hidden = true;
      return;
    }
    say("");
    draw();
  } catch (e) {
    if (my === run) say(`Couldn't load the gauges (${e.message}). Check the connection and try again.`, true);
  }
}

// ---- Card ----

function lastHour(d) {
  for (let i = d.hours.length - 1; i >= 0; i--) if (d.rows.some((r) => typeof r[d.hours[i]] === "number")) return d.hours[i];
  return "";
}

function panel(name, colour, d, top) {
  const skip = skipSuspects();
  const all = d.rows.filter((r) => r.district_name === name);
  const on = all.filter((r) => typeof r.total === "number");
  const left = on.filter((r) => skip && d.flags.get(gaugeKey(r)));
  const counted = on.filter((r) => !left.includes(r));
  const wet = counted.filter((r) => r.total > 0).sort((a, b) => b.total - a.total || a.station_name.localeCompare(b.station_name));
  const shown = top ? wet.slice(0, top) : wet;
  const max = shown[0]?.total || 1;
  const mean = counted.length ? counted.reduce((s, r) => s + r.total, 0) / counted.length : null;
  const rows = shown
    .map(
      (r, i) => `<li${i < 3 ? ' class="dr-top"' : ""}>
        <span class="dr-rank">${String(i + 1).padStart(2, "0")}</span>
        <span class="dr-name">${esc(tidy(r.station_name))}</span>
        <span class="dr-bar"><i style="width:${Math.max(2, (r.total / max) * 100).toFixed(1)}%"></i></span>
        <span class="dr-mm">${mm(r.total)}</span>
      </li>`
    )
    .join("");
  const empty = !all.length
    ? "TN-SMART has no gauges in this district."
    : !counted.length
      ? "None of its gauges reported."
      : `No rain at any of its ${counted.length} gauges.`;
  const foot = [
    `${on.length} of ${all.length} gauges reporting`,
    mean != null ? `district average ${mm(mean)} mm` : "",
    left.length ? `${left.length} suspect left out` : "",
  ].filter(Boolean);
  return `<section class="dr-panel" style="--dr:${colour}">
      <h3 class="dr-head">${esc(name.toUpperCase())}</h3>
      ${
        shown.length
          ? `<div class="dr-cols"><span>Rank</span><span>Station</span><span>Rainfall</span></div><ol class="dr-list">${rows}</ol>`
          : `<p class="dr-empty">${empty}</p>`
      }
      <p class="dr-foot">${foot.join(" · ")}${top && wet.length > top ? ` · top ${top} of ${wet.length} with rain` : ""}</p>
    </section>`;
}

// Rain day words for the banner.
function dayLine(d, sep) {
  const running = shownDay >= currentRainDay();
  const upto = running ? lastHour(d) : "";
  return running
    ? `SINCE 8:30 AM ${longDay(shiftDay(shownDay, -1)).toUpperCase()}${upto ? `${sep}UP TO ${upto}` : ""}`
    : `24 HOURS ENDING 8:30 AM${sep}${longDay(shownDay).toUpperCase()}`;
}

// Rain in mm as a cell colour, as on the bulletins (light to deep green, then yellow, orange, red).
function heat(v) {
  if (v >= 115.6) return ["#c62828", "#fff"];
  if (v >= 64.5) return ["#f9d71c", "#1d2733"];
  if (v >= 35.6) return ["#2e7d32", "#fff"];
  if (v >= 15.6) return ["#66bb6a", "#10291a"];
  if (v >= 2.5) return ["#c8e6c9", "#10291a"];
  return ["#eef2f5", "#1d2733"];
}

function drawList(d, ktcc) {
  const skip = skipSuspects();
  const n = Number($("dr-n").value) || 50;
  const area = ktcc ? "KTCC (CHENNAI)" : "TAMIL NADU";
  const pool = d.rows.filter((r) => typeof r.total === "number" && (!ktcc || KTCC.includes(r.district_name)));
  const left = pool.filter((r) => skip && d.flags.get(gaugeKey(r)));
  const wet = pool
    .filter((r) => r.total > 0 && !left.includes(r))
    .sort((a, b) => b.total - a.total || a.station_name.localeCompare(b.station_name));
  const list = wet.slice(0, n);
  $("dr-title").innerHTML = `${area} <b>|</b> <strong>TOP ${list.length || n} RAINFALL</strong>`;
  $("dr-sub").textContent = `${dayLine(d, " • ")} • RAINFALL IN mm`;
  if (!list.length) {
    $("dr-panels").innerHTML = `<p class="dr-empty">No rain at any of the ${pool.length} gauges reporting.</p>`;
    return;
  }
  const row = (r, i) => {
    const [bg, fg] = heat(r.total);
    const src = sourceOf(r.station_name);
    const zone = zoneOf(r.station_name);
    return `<li${i < 3 ? ' class="dr-top"' : ""}>
        <span class="dr-rank">${String(i + 1).padStart(2, "0")}</span>
        <span class="dr-src">${src}</span>
        <span class="dr-dist">${esc(r.district_name)}</span>
        <span class="dr-name">${esc(tidy(r.station_name))}<small>${esc(r.district_name)}${zone ? ` · ${esc(zone)}` : ""} · ${src}</small></span>
        <span class="dr-mm" style="background:${bg};color:${fg}">${mm(r.total)}</span>
      </li>`;
  };
  const head = `<div class="dr-lcols"><span>No.</span><span>Source</span><span>District</span><span>Station</span><span>mm</span></div>`;
  // Two tables side by side on the wide card, as on the bulletins.
  const half = Math.ceil(list.length / 2);
  const parts = $("dr-wide").checked && list.length > 10 ? [list.slice(0, half), list.slice(half)] : [list];
  let at = 0;
  const tables = parts
    .map((part) => {
      const html = `<div class="dr-table">${head}<ol class="dr-llist">${part.map((r) => row(r, at++)).join("")}</ol></div>`;
      return html;
    })
    .join("");
  const top = list[0];
  const counts = new Map();
  for (const r of list) counts.set(r.district_name, (counts.get(r.district_name) || 0) + 1);
  const byDistrict = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const notes = [`${pool.length} gauges reporting, ${wet.length} with rain`];
  if (left.length) notes.push(`${left.length} suspect left out`);
  $("dr-panels").innerHTML = `<div class="dr-tables">${tables}</div>
    <div class="dr-boxes">
      <div class="dr-box dr-high">
        <span>Highest rainfall</span>
        <strong>${mm(top.total)} mm</strong>
        <p>at ${esc(tidy(top.station_name))}, ${esc(top.district_name)} district</p>
      </div>
      <div class="dr-box">
        <span>Top districts (places in the top ${list.length})</span>
        <ul class="dr-counts">${byDistrict.map(([k, v]) => `<li>${esc(k)} <b>${v}</b></li>`).join("")}</ul>
      </div>
    </div>
    <p class="dr-foot">${notes.join(" · ")}</p>`;
}

function draw() {
  const card = $("dr-card");
  const d = cache.get(shownDay);
  if (!d) return;
  const wide = $("dr-wide").checked;
  const type = $("dr-type").value;
  card.classList.toggle("dr-wide", wide);
  card.classList.toggle("dr-listcard", type !== "districts");
  $("dr-scroll").classList.toggle("dr-scrolls", wide);
  if (type !== "districts") {
    card.hidden = false;
    drawList(d, type === "ktcc");
    const running = shownDay >= currentRainDay();
    say(running ? "The rain day is still running: the card shows the rain so far." : "");
    return;
  }
  if (!picked.length) {
    card.hidden = true;
    say("Pick one or more districts.");
    return;
  }
  card.hidden = false;
  const top = Number($("dr-top").value) || 0;
  const running = shownDay >= currentRainDay();
  const upto = running ? lastHour(d) : "";
  $("dr-title").innerHTML = `${picked.map((n) => esc(n.toUpperCase())).join(" <b>•</b> ")} <strong>RAINFALL</strong>`;
  $("dr-sub").textContent = `${dayLine(d, " | ")} | RAINFALL IN mm`;
  $("dr-panels").innerHTML = picked.map((n, i) => panel(n, COLOURS[i % COLOURS.length], d, top)).join("");
  if (running) say(`The rain day is still running: the card shows the rain so far${upto ? `, up to ${upto}` : ""}.`);
}

// ---- Screen ----

export function initDistRank() {
  picked = savedPicks();
  const box = $("dr-pick");
  box.replaceChildren(
    ...TN_DISTRICTS.map(([n]) => {
      const label = document.createElement("label");
      label.className = "dr-chip";
      label.innerHTML = `<input type="checkbox" value="${esc(n)}" /> <span>${esc(n)}</span>`;
      return label;
    })
  );
  box.addEventListener("change", (e) => {
    const v = e.target.value;
    setPicks(e.target.checked ? [...picked.filter((x) => x !== v), v] : picked.filter((x) => x !== v));
  });
  $("dr-ktcc").addEventListener("click", () => setPicks([...KTCC]));
  $("dr-home").addEventListener("click", () => setPicks([homeDistrict()]));
  $("dr-clear").addEventListener("click", () => setPicks([]));
  drawPicker();

  const top = $("dr-top");
  top.value = String(read(TOP_KEY, 15));
  if (!top.value) top.value = "15";
  top.addEventListener("change", () => {
    write(TOP_KEY, Number(top.value));
    draw();
  });
  const type = $("dr-type");
  type.value = String(read(TYPE_KEY, "districts"));
  if (!type.value) type.value = "districts";
  const showControls = () => {
    const list = type.value !== "districts";
    $("dr-n-label").hidden = !list;
    $("dr-top-label").hidden = list;
    $("dr-picker").hidden = list;
  };
  showControls();
  type.addEventListener("change", () => {
    write(TYPE_KEY, type.value);
    showControls();
    draw();
  });
  const n = $("dr-n");
  n.value = String(read(N_KEY, 50));
  if (!n.value) n.value = "50";
  n.addEventListener("change", () => {
    write(N_KEY, Number(n.value));
    draw();
  });
  $("dr-wide").checked = !!read(WIDE_KEY, false);
  $("dr-wide").addEventListener("change", () => {
    write(WIDE_KEY, $("dr-wide").checked);
    draw();
  });

  const date = $("dr-date");
  date.max = currentRainDay();
  date.addEventListener("change", () => {
    userDay = !!date.value;
    load();
  });
  const step = (n) => {
    const next = shiftDay(date.value || shiftDay(currentRainDay(), -1), n);
    if (next > currentRainDay()) return;
    date.value = next;
    userDay = true;
    load();
  };
  $("dr-prev").addEventListener("click", () => step(-1));
  $("dr-next").addEventListener("click", () => step(1));
  $("dr-refresh").addEventListener("click", () => load(true));
}

export function showDistRank() {
  $("dr-date").max = currentRainDay();
  // A different list may have been saved (Settings restore).
  const saved = savedPicks();
  if (saved.join() !== picked.join()) {
    picked = saved;
    drawPicker();
  }
  load();
}
