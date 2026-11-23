// Month card (#monthcard): this month's rain against normal, as one card to
// share.
//
// - IMD's rainfall pages (js/monsoon.js figuresFor("M")): the month's actual,
//   normal and departure for Chennai, the other KTCC districts, Tamil Nadu and
//   the Tamil Nadu–Puducherry subdivision.
// - TN-SMART: the Chennai district mean of its automatic gauges for every
//   rain day of the month (js/records.js), for the running total chart and the
//   wettest days. TN-SMART has no normals, so its total is set against IMD's
//   Chennai district normal.
//
// The Share button comes from data-share (js/snap.js), so the picture follows
// Settings → Shared pictures (© name, corner, band) like every other card.
import { category, figuresFor } from "./monsoon.js";
import { loadMeans } from "./records.js";
import { currentRainDay, shiftDay, niceDay } from "./gaugedays.js";
import { drawLines } from "./chart.js";

const SAVED_KEY = "myweather.monthcard";
const TTL = 15 * 60 * 1000;
const KTCC = ["CHENNAI", "THIRUVALLUR", "KANCHEEPURAM", "CHENGALPATTU"];
const NAMES = { CHENNAI: "Chennai", THIRUVALLUR: "Thiruvallur", KANCHEEPURAM: "Kancheepuram", CHENGALPATTU: "Chengalpattu" };

const $ = (id) => document.getElementById(id);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const mm = (v) => (isNum(v) ? (v >= 100 ? String(Math.round(v)) : v.toFixed(1)) : "–");
const pct = (p) => (isNum(p) ? `${p > 0 ? "+" : p < 0 ? "−" : "±"}${Math.abs(Math.round(p))}%` : "–");
const longDay = (iso, year = false) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}) });

let figures = null;
let loadedAt = 0;
let run = 0;

function say(text, error = false) {
  const s = $("mc-status");
  s.textContent = text;
  s.className = error ? "status error" : "status";
}

// One figure: actual, normal and departure, with IMD's category.
function figure(a) {
  if (!a) return null;
  let dep = a.departure;
  if (!isNum(dep) && isNum(a.actual) && isNum(a.normal) && a.normal > 0) dep = ((a.actual - a.normal) / a.normal) * 100;
  return { actual: a.actual, normal: a.normal, dep, cat: category(isNum(dep) ? Math.round(dep) : null) };
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

// First day of the month IMD's figures cover, and the day they run to.
function span(d) {
  const to = d.district.date || d.state.date || currentRainDay();
  const label = d.state.labels?.monthly || d.district.labels?.monthly || "";
  const m = label.match(/(\d{2})-(\d{2})-(\d{4})/);
  const from = m ? `${m[3]}-${m[2]}-${m[1]}` : `${to.slice(0, 7)}-01`;
  return { from, to };
}

function renderImd(d) {
  const { from, to } = span(d);
  const month = new Date(`${from}T12:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const days = Math.round((new Date(`${to}T12:00:00`) - new Date(`${from}T12:00:00`)) / 864e5) + 1;
  $("mc-title").textContent = `Chennai · Rain in ${month}`;
  $("mc-sub").textContent = `${longDay(from)} to ${longDay(to, true)} · ${days} days · IMD rainfall figures`;

  const area = (k) => d.district.areas[k];
  const tiles = [];
  const chennai = figure(area("CHENNAI"));
  const tn = figure(Object.entries(d.state.areas).find(([k]) => k.startsWith("TAMIL NADU"))?.[1]);
  if (chennai) tiles.push(tile("Chennai district", "IMD, all its gauges", chennai));
  if (tn) tiles.push(tile("Tamil Nadu", "IMD, state average", tn));
  tiles.push(Object.assign(document.createElement("div"), { id: "mc-tns-tile", className: "sc-tile sc-pending", textContent: "TN-SMART gauges: loading…" }));
  $("mc-tiles").replaceChildren(...tiles);

  const rows = [];
  for (const k of KTCC.slice(1)) {
    const f = figure(area(k));
    if (f) rows.push(row(NAMES[k], f));
  }
  const sub = figure(Object.entries(d.subdivision.areas).find(([k]) => /^TN\b|TAMIL/.test(k))?.[1]);
  if (sub) rows.push(row("TN, Puducherry & Karaikal", sub, true));
  $("mc-rows").replaceChildren(...rows);
  $("mc-rows-wrap").hidden = !rows.length;
  return { from, to, normal: area("CHENNAI")?.normal };
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
  const box = $("mc-tns-tile");
  if (!have) {
    if (box) box.textContent = "TN-SMART gauges: no figures this month.";
    $("mc-chart-wrap").hidden = true;
    return;
  }
  const running = days[days.length - 1] === today && isNum(means[today]?.Chennai);
  const t = tile("Chennai gauges", `TN-SMART, ${have} days${running ? " incl. today so far" : ""}`, figure({ actual: sum, normal }));
  t.id = "mc-tns-tile";
  t.querySelector(".sc-normal").textContent = isNum(normal) ? `Against IMD's district normal, ${mm(normal)} mm` : "";
  box?.replaceWith(t);

  $("mc-chart-wrap").hidden = false;
  const ticks = [];
  days.forEach((d, i) => {
    if ((d.slice(8) === "01" || d.slice(8) === "08" || d.slice(8) === "15" || d.slice(8) === "22") && i < days.length - 3) ticks.push({ at: i, label: niceDay(d) });
  });
  const marks = [{ at: days.length - 1, value: sum }];
  if (isNum(normal)) marks.push({ at: days.length - 1, value: normal, cls: "sc-normal-mark" });
  const points = days.map((d, i) => ({
    at: i,
    text: `${niceDay(d)}: ${isNum(means[d]?.Chennai) ? `${mm(means[d].Chennai)} mm, ${mm(cum[i])} mm so far` : "no figure"}`,
  }));
  drawLines(
    $("mc-chart"),
    $("mc-readout"),
    { count: days.length, series: [{ values: cum, cls: "sc-line" }], ticks, points, marks },
    `${mm(sum)} mm so far${isNum(normal) ? ` (hollow dot: IMD's Chennai normal so far, ${mm(normal)} mm)` : ""}. Tap the chart for a day.`,
    { max: Math.ceil((Math.max(sum, normal || 0) * 1.08) / 50) * 50 || 50 }
  );

  const wet = days
    .filter((d) => isNum(means[d]?.Chennai) && means[d].Chennai > 0)
    .sort((a, b) => means[b].Chennai - means[a].Chennai)
    .slice(0, 3);
  const rainy = days.filter((d) => means[d]?.Chennai >= 2.5).length;
  $("mc-wet").textContent = wet.length
    ? `Wettest days: ${wet.map((d) => `${niceDay(d)} ${mm(means[d].Chennai)} mm`).join(" · ")}. ${rainy} rainy days (2.5 mm or more).`
    : "No rain at the gauges yet this month.";
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
  if (!figures) {
    const saved = loadSaved();
    if (saved?.figures) {
      figures = saved.figures;
      renderImd(figures);
    }
  }
  if (!force && figures && Date.now() - loadedAt < TTL) return;
  say("Loading IMD's monthly rainfall…");
  try {
    figures = await figuresFor("M");
    loadedAt = Date.now();
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify({ at: loadedAt, figures }));
    } catch {}
  } catch (e) {
    if (!figures) {
      say(`Couldn't load IMD's rainfall figures (${e.message}).`, true);
      return;
    }
    say(`Couldn't reach IMD (${e.message}); showing the saved figures.`, true);
  }
  if (myRun !== run) return;
  const info = renderImd(figures);
  say("Adding up TN-SMART's Chennai gauges…");
  try {
    const means = await loadMeans((done, total) => myRun === run && total > 3 && say(`TN-SMART days: ${done} of ${total}…`), info.from);
    renderTns(means, info, myRun);
    if (myRun === run) say(`Updated ${new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}.`);
  } catch (e) {
    if (myRun === run) say(`IMD figures shown; TN-SMART didn't load (${e.message}).`, true);
  }
}

export function initMonthCard() {
  $("mc-refresh").addEventListener("click", () => refresh(true));
}

export function showMonthCard() {
  refresh();
}
