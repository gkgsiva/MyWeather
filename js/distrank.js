// District rainfall (#distrank): a ranking card of the wettest rain gauges in
// each district you pick, one coloured panel per district, made to be shared
// as a picture (like the "24 hours ending 8:30 AM" cards passed around on
// WhatsApp).
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
const KTCC = ["Chennai", "Kancheepuram", "Tiruvallur", "Chengalpattu"];
// One colour per panel, in the order the districts were picked.
const COLOURS = ["#1a6a88", "#6a58a6", "#1a876a", "#b0692f", "#b23a55", "#4f6e1e", "#2f4f9e", "#8a4f8f"];
const HOUR_RE = /^\d\d:\d\d [AP]M$/;
const MAX_PICK = 8;

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

function draw() {
  const card = $("dr-card");
  const d = cache.get(shownDay);
  if (!d) return;
  const wide = $("dr-wide").checked;
  card.classList.toggle("dr-wide", wide);
  $("dr-scroll").classList.toggle("dr-scrolls", wide);
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
  $("dr-sub").textContent = running
    ? `SINCE 8:30 AM ${longDay(shiftDay(shownDay, -1)).toUpperCase()}${upto ? ` | UP TO ${upto}` : ""} | RAINFALL IN mm`
    : `24 HOURS ENDING 8:30 AM | ${longDay(shownDay).toUpperCase()} | RAINFALL IN mm`;
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
