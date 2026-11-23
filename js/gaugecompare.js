// Compare two TN-SMART rain gauges (#gauges, Compare tab): their rain each
// day for the last 7 or 30 rain days, drawn together, with totals side by side.
// Days come from js/gaugedays.js (finished days are kept on the phone).
import { drawLines } from "./chart.js";
import { getDays, missing, daysEnding, gaugeKey, niceDay } from "./gaugedays.js";

const KEY = "myweather.gauges.compare";
const $ = (id) => document.getElementById(id);
const fmt = (v) => (typeof v === "number" ? (Math.round(v * 10) / 10).toFixed(v % 1 ? 1 : 0) : "–");

let ctx = null; // { rows(), picked(), day() } from gauges.js
let sel = [null, null]; // gauge keys
let days = 30;
let run = 0;
let labels = new Map(); // datalist text -> key

try {
  const s = JSON.parse(localStorage.getItem(KEY));
  if (s) {
    sel = [s.a || null, s.b || null];
    if (s.days === 7 || s.days === 30) days = s.days;
  }
} catch {}
const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ a: sel[0], b: sel[1], days }));
  } catch {}
};

const label = (r) => `${r.station_name} · ${r.district_name}`;
const byKey = (k) => ctx.rows().find((r) => gaugeKey(r) === k);

function fillList() {
  labels = new Map();
  const list = $("tgc-list");
  list.replaceChildren();
  for (const r of ctx.rows()) {
    labels.set(label(r), gaugeKey(r));
    list.append(new Option(label(r)));
  }
}

function syncInputs() {
  [$("tgc-a"), $("tgc-b")].forEach((inp, i) => {
    const r = sel[i] && byKey(sel[i]);
    if (r) inp.value = label(r);
  });
}

function choose(i, text) {
  const k = labels.get(text.trim());
  if (!k) return;
  sel[i] = k;
  save();
  drawCompare();
}

function paintButtons() {
  for (const b of document.querySelectorAll("#tgc-pick button")) b.setAttribute("aria-pressed", String(Number(b.dataset.days) === days));
}

function stats(vals) {
  const nums = vals.filter((v) => typeof v === "number");
  const max = nums.length ? Math.max(...nums) : null;
  return {
    total: nums.reduce((a, b) => a + b, 0),
    reported: nums.length,
    rainy: nums.filter((v) => v >= 2.5).length,
    max,
    maxAt: max ? vals.indexOf(max) : -1,
  };
}

export async function drawCompare() {
  if (!ctx) return;
  paintButtons();
  const note = $("tgc-note");
  const chart = $("tgc-chart");
  const readout = $("tgc-readout");
  const head = $("tgc-head");
  const out = $("tgc-stats");
  const gs = sel.map((k) => (k ? byKey(k) : null));
  if (!ctx.rows().length) {
    note.textContent = "Loading the gauges…";
    return;
  }
  if (!gs[0] || !gs[1]) {
    head.textContent = "Two gauges";
    chart.replaceChildren();
    readout.textContent = "";
    out.replaceChildren();
    $("tgc-legend").hidden = true;
    note.textContent = "Pick two gauges above, or tap one on the map and use it as A or B.";
    return;
  }
  const [a, b] = gs;
  head.textContent = `${a.station_name} and ${b.station_name}`;
  const n = ++run;
  const list = daysEnding(ctx.day(), days);
  const need = await missing(list);
  note.textContent = need ? `Downloading ${need} day${need > 1 ? "s" : ""} (about ${Math.max(1, Math.round(need * 0.7))} MB)…` : "Loading…";
  const got = await getDays(list, (done, total) => {
    if (n === run && need) note.textContent = `Downloading… ${done} of ${total} days`;
  });
  if (n !== run) return;
  const vals = [a, b].map((r) => {
    const k = gaugeKey(r);
    return got.map((d) => {
      if (!d) return undefined;
      const g = d.gauges.find((x) => `${x[0]}|${x[1]}` === k);
      return g ? g[4] : null;
    });
  });
  const lines = vals.map((v) => v.map((x) => (typeof x === "number" ? x : null)));
  const every = days > 10 ? 5 : 1;
  drawLines(
    chart,
    readout,
    {
      count: list.length,
      series: [
        { values: lines[0], cls: "s1" },
        { values: lines[1], cls: "s2" },
      ],
      ticks: list.map((d, i) => ({ at: i, label: niceDay(d, { month: undefined }) })).filter((_, i) => (list.length - 1 - i) % every === 0),
      points: list.map((d, i) => ({
        at: i,
        text: `Rain day ending ${niceDay(d)}: ${a.station_name} ${vals[0][i] === undefined ? "couldn't download" : typeof vals[0][i] === "number" ? `${fmt(vals[0][i])} mm` : "no data"}` +
          ` · ${b.station_name} ${vals[1][i] === undefined ? "couldn't download" : typeof vals[1][i] === "number" ? `${fmt(vals[1][i])} mm` : "no data"}`,
      })),
    },
    "Tap a day to read both gauges."
  );
  const lg = $("tgc-legend");
  lg.hidden = false;
  lg.replaceChildren();
  [a, b].forEach((r, i) => {
    const s = document.createElement("span");
    const sw = document.createElement("span");
    sw.className = `swatch${i ? " s2" : ""}`;
    s.append(sw, `${r.station_name} (${r.district_name})`);
    lg.append(s, " ");
  });
  const st = vals.map(stats);
  const rows = [
    ["", a.station_name, b.station_name],
    [`Rain, ${days} days`, `${fmt(st[0].total)} mm`, `${fmt(st[1].total)} mm`],
    ["Rainy days (2.5 mm+)", st[0].rainy, st[1].rainy],
    ["Wettest day", st[0].max ? `${fmt(st[0].max)} mm · ${niceDay(list[st[0].maxAt])}` : "–", st[1].max ? `${fmt(st[1].max)} mm · ${niceDay(list[st[1].maxAt])}` : "–"],
    ["Days with data", st[0].reported, st[1].reported],
  ];
  out.replaceChildren();
  const thead = out.createTHead().insertRow();
  rows[0].forEach((t, i) => {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = t;
    thead.append(th);
    if (i === 1) th.className = "tgc-a";
  });
  const tb = out.createTBody();
  for (const r of rows.slice(1)) {
    const tr = tb.insertRow();
    r.forEach((t, i) => {
      const c = i ? tr.insertCell() : document.createElement("th");
      if (!i) {
        c.scope = "row";
        tr.append(c);
      }
      c.textContent = String(t);
    });
  }
  const diff = st[0].total - st[1].total;
  const both = st[0].reported && st[1].reported;
  note.textContent =
    `${days} rain days to ${niceDay(ctx.day())}. ` +
    (both
      ? Math.abs(diff) < 0.05
        ? "Both gauges measured the same total."
        : `${diff > 0 ? a.station_name : b.station_name} got ${fmt(Math.abs(diff))} mm more.`
      : "One of the gauges sent no data in this time.") +
    " The last day may still be running.";
}

export function initCompare(c) {
  ctx = c;
  for (const [i, id] of [$("tgc-a"), $("tgc-b")].map((e, i) => [i, e.id])) {
    $(id).addEventListener("change", () => choose(i, $(id).value));
    $(id).addEventListener("input", () => labels.has($(id).value.trim()) && choose(i, $(id).value));
  }
  for (const [i, id] of [[0, "tgc-use-a"], [1, "tgc-use-b"]]) {
    $(id).addEventListener("click", () => {
      const p = ctx.picked();
      if (!p) return;
      sel[i] = gaugeKey(p);
      save();
      syncInputs();
      drawCompare();
    });
  }
  $("tgc-swap").addEventListener("click", () => {
    sel.reverse();
    save();
    syncInputs();
    drawCompare();
  });
  for (const b of document.querySelectorAll("#tgc-pick button"))
    b.addEventListener("click", () => {
      days = Number(b.dataset.days);
      save();
      drawCompare();
    });
}

/** Called when a day's gauges have loaded. */
let listed = null;
export function refreshCompare() {
  if (!ctx) return;
  const rows = ctx.rows();
  if (rows !== listed) {
    listed = rows;
    fillList();
    syncInputs();
  }
  if (!$("tg-tab-compare").hidden) drawCompare();
}
