// Season card (#seasoncard): Chennai's northeast monsoon so far against
// normal, as one card to share.
//
// - IMD's daily report (the RMC Chennai PDF, read into JSON on the data
//   branch, js/imdreport.js): Nungambakkam and Meenambakkam season rain and
//   departure, and the season actual and normal of Chennai, the other KTCC
//   districts and Tamil Nadu.
// - TN-SMART: the Chennai district mean of its automatic gauges for every
//   rain day of the season (js/records.js keeps the days on the phone), for
//   the running total chart and the wettest days. TN-SMART has no normals, so
//   its total is set against IMD's Chennai district normal.
//
// The Share button comes from data-share (js/snap.js), so the picture follows
// Settings → Shared pictures (© name, corner, band) like every other card.
import { DATA } from "./imdreport.js";
import { category } from "./monsoon.js";
import { loadMeans } from "./records.js";
import { currentRainDay, shiftDay, niceDay } from "./gaugedays.js";
import { drawLines } from "./chart.js";

const SAVED_KEY = "myweather.seasoncard";
const TTL = 15 * 60 * 1000;
const KTCC = ["Chennai", "Thiruvallur", "Kancheepuram", "Chengalpattu"];

const $ = (id) => document.getElementById(id);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const mm = (v) => (isNum(v) ? (v >= 100 ? String(Math.round(v)) : v.toFixed(1)) : "–");
const pct = (p) => (isNum(p) ? `${p > 0 ? "+" : p < 0 ? "−" : "±"}${Math.abs(Math.round(p))}%` : "–");
const longDay = (iso, year = false) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}) });

let report = null;
let loadedAt = 0;
let run = 0;

function say(text, error = false) {
  const s = $("sc-status");
  s.textContent = text;
  s.className = error ? "status error" : "status";
}

async function getJson(name) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(`${DATA}${name}?t=${Math.floor(Date.now() / 600000)}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// One figure: actual, normal and departure, with IMD's category.
function figure({ actual, normal, dep }) {
  if (!isNum(dep) && isNum(actual) && isNum(normal) && normal > 0) dep = ((actual - normal) / normal) * 100;
  return { actual, normal, dep, cat: category(isNum(dep) ? Math.round(dep) : null) };
}

function stationFigure(c) {
  if (!c || !isNum(c.season)) return null;
  const normal = isNum(c.seasonDep) ? c.season - c.seasonDep : null;
  return figure({ actual: c.season, normal });
}

function tile(label, sub, f) {
  const el = document.createElement("div");
  el.className = `sc-tile cat-${f.cat.cls}`;
  const max = Math.max(f.actual || 0, f.normal || 0, 1);
  el.innerHTML = `
    <p class="sc-tile-name"></p>
    <p class="sc-tile-sub"></p>
    <p class="sc-big"><b></b> mm</p>
    <p class="sc-dep"><b></b> <span></span></p>
    <div class="sc-track"><i></i><u></u></div>
    <p class="sc-normal"></p>`;
  el.querySelector(".sc-tile-name").textContent = label;
  el.querySelector(".sc-tile-sub").textContent = sub;
  el.querySelector(".sc-big b").textContent = mm(f.actual);
  el.querySelector(".sc-dep b").textContent = pct(f.dep);
  el.querySelector(".sc-dep span").textContent = f.cat.name;
  el.querySelector(".sc-track i").style.width = `${((f.actual || 0) / max) * 100}%`;
  const u = el.querySelector(".sc-track u");
  if (isNum(f.normal)) u.style.left = `${(f.normal / max) * 100}%`;
  else u.remove();
  el.querySelector(".sc-normal").textContent = isNum(f.normal) ? `Normal so far ${mm(f.normal)} mm` : "No normal for this one";
  return el;
}

function row(name, f, bold = false) {
  const li = document.createElement("li");
  li.className = `sc-row cat-${f.cat.cls}${bold ? " sc-row-total" : ""}`;
  li.innerHTML = '<span class="sc-row-name"></span><span class="sc-row-val"></span><span class="sc-row-dep"></span>';
  li.querySelector(".sc-row-name").textContent = name;
  li.querySelector(".sc-row-val").textContent = `${mm(f.actual)} / ${mm(f.normal)}`;
  li.querySelector(".sc-row-dep").textContent = `${pct(f.dep)} ${f.cat.name}`;
  return li;
}

function renderImd(r) {
  const from = r.chennai?.seasonFrom || r.districts?.period?.[0] || `${r.date.slice(0, 4)}-10-01`;
  const to = r.districts?.period?.[1] || r.date;
  const days = Math.round((new Date(`${to}T12:00:00`) - new Date(`${from}T12:00:00`)) / 864e5) + 1;
  const ne = from.slice(5) === "10-01";
  $("sc-title").textContent = ne ? `Chennai · Northeast monsoon ${from.slice(0, 4)}` : "Chennai · Rain season so far";
  $("sc-sub").textContent = `${longDay(from)} to ${longDay(to, true)} · ${days} days · IMD report of ${longDay(r.date)}`;

  const tiles = [];
  const n = stationFigure(r.chennai?.N);
  const ap = stationFigure(r.chennai?.AP);
  const dist = r.districts?.rows?.find((x) => x.name === "Chennai")?.season;
  if (n) tiles.push(tile("Nungambakkam", "IMD observatory", n));
  if (ap) tiles.push(tile("Meenambakkam", "IMD airport", ap));
  if (dist) tiles.push(tile("Chennai district", "IMD, all its gauges", figure(dist)));
  tiles.push(Object.assign(document.createElement("div"), { id: "sc-tns-tile", className: "sc-tile sc-pending", textContent: "TN-SMART gauges: loading…" }));
  $("sc-tiles").replaceChildren(...tiles);

  const rows = [];
  for (const name of KTCC.slice(1)) {
    const d = r.districts?.rows?.find((x) => x.name.toLowerCase() === name.toLowerCase())?.season;
    if (d) rows.push(row(name, figure(d)));
  }
  const tn = r.districts?.rows?.find((x) => x.total)?.season;
  if (tn) rows.push(row("Tamil Nadu", figure(tn), true));
  $("sc-rows").replaceChildren(...rows);
  $("sc-rows-wrap").hidden = !rows.length;
  return { from, to, normal: dist?.normal };
}

function renderTns(means, { from, normal }, myRun) {
  if (myRun !== run) return;
  const today = currentRainDay();
  const days = [];
  for (let d = from; d <= today; d = shiftDay(d, 1)) days.push(d);
  let sum = 0;
  let have = 0;
  const cum = days.map((d) => {
    const v = means[d] ? means[d].Chennai : undefined;
    if (isNum(v)) {
      sum += v;
      have++;
      return sum;
    }
    return have ? sum : null;
  });
  const tileBox = $("sc-tns-tile");
  if (!have) {
    if (tileBox) tileBox.textContent = "TN-SMART gauges: no figures for this season.";
    $("sc-chart-wrap").hidden = true;
    return;
  }
  const running = days[days.length - 1] === today && isNum(means[today]?.Chennai);
  const f = figure({ actual: sum, normal });
  const t = tile("Chennai gauges", `TN-SMART, ${have} rain days${running ? " incl. today so far" : ""}`, f);
  t.id = "sc-tns-tile";
  t.querySelector(".sc-normal").textContent = isNum(normal) ? `Against IMD's district normal, ${mm(normal)} mm` : "";
  tileBox?.replaceWith(t);

  // Running total.
  $("sc-chart-wrap").hidden = false;
  const ticks = [];
  days.forEach((d, i) => {
    if ((d.slice(8) === "01" || d.slice(8) === "15") && i < days.length - 4) ticks.push({ at: i, label: niceDay(d) });
  });
  // Labels at the right edge would be cut off; the numbers are in the readout.
  const marks = [{ at: days.length - 1, value: sum }];
  if (isNum(normal)) marks.push({ at: days.length - 1, value: normal, cls: "sc-normal-mark" });
  const points = days.map((d, i) => ({
    at: i,
    text: `${niceDay(d)}: ${isNum(means[d]?.Chennai) ? `${mm(means[d].Chennai)} mm, ${mm(cum[i])} mm so far` : "no figure"}`,
  }));
  drawLines(
    $("sc-chart"),
    $("sc-readout"),
    { count: days.length, series: [{ values: cum, cls: "sc-line" }], ticks, points, marks },
    `${mm(sum)} mm so far${isNum(normal) ? ` (hollow dot: IMD's Chennai normal so far, ${mm(normal)} mm)` : ""}. Tap the chart for a day.`,
    { max: Math.ceil((Math.max(sum, normal || 0) * 1.08) / 100) * 100 || 100 }
  );

  // Wettest days.
  const wet = days
    .filter((d) => isNum(means[d]?.Chennai) && means[d].Chennai > 0)
    .sort((a, b) => means[b].Chennai - means[a].Chennai)
    .slice(0, 3);
  const rainy = days.filter((d) => means[d]?.Chennai >= 2.5).length;
  $("sc-wet").textContent = wet.length
    ? `Wettest days: ${wet.map((d) => `${niceDay(d)} ${mm(means[d].Chennai)} mm`).join(" · ")}. ${rainy} rainy days (2.5 mm or more).`
    : "No rain at the gauges yet this season.";
}

function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(SAVED_KEY));
  } catch {
    return null;
  }
}

async function refresh(force = false) {
  const myRun = ++run;
  if (!report) {
    const saved = loadSaved();
    if (saved?.report) {
      report = saved.report;
      renderImd(report);
    }
  }
  if (!force && report && Date.now() - loadedAt < TTL) return;
  say("Loading IMD's daily report…");
  try {
    report = await getJson("latest.json");
    loadedAt = Date.now();
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify({ at: loadedAt, report }));
    } catch {}
  } catch (e) {
    if (!report) {
      say(`Couldn't load IMD's daily report (${e.message}).`, true);
      return;
    }
    say(`Couldn't reach IMD's report (${e.message}); showing the saved one.`, true);
  }
  if (myRun !== run) return;
  const info = renderImd(report);
  say("Adding up TN-SMART's Chennai gauges…");
  try {
    const means = await loadMeans((done, total) => myRun === run && total > 3 && say(`TN-SMART days: ${done} of ${total}…`), info.from);
    renderTns(means, info, myRun);
    if (myRun === run) say(`Updated ${new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}.`);
  } catch (e) {
    if (myRun === run) say(`IMD figures shown; TN-SMART didn't load (${e.message}).`, true);
  }
}

export function initSeasonCard() {
  $("sc-refresh").addEventListener("click", () => refresh(true));
}

export function showSeasonCard() {
  refresh();
}
