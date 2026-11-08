// Lake trends (#lakes): Chennai's five reservoirs over the last 30 or 90 days,
// against the same days last year.
//
// Source: TN-SMART's daily reservoir report, one PDF a day (about 30 KB) with
// every dam in Tamil Nadu, back to 2024 at least:
//   https://beta-tnsmart.rimes.int/DATA/Rainfall/daily_reservoir/reservoir_<DD-MM-YYYY>.pdf
// The site allows cross-site reads. The PDFs are made by TCPDF with plain
// Helvetica text, so a small reader is enough: each text item is placed with
// "x y Td" (plus "1 0 0 1 dx dy cm" shifts), and a lake's figures are the
// numbers on the line of its name: depth, capacity, current depth, storage
// (mcft), percent full. Days already read are kept on the phone.
import { drawLines } from "./chart.js";

const BASE = "https://beta-tnsmart.rimes.int/DATA/Rainfall/daily_reservoir/";
const SAVED_KEY = "myweather.lakes.days"; // { "2026-11-07": { Poondi: [storage, capacity], … } | 0 }
const RANGE_KEY = "myweather.lakes.range";

// Names as printed (wrapped names start with these).
export const LAKES = [
  { name: "Poondi", re: /^Poondi/ },
  { name: "Puzhal (Red Hills)", re: /^Redhills|^Red Hills|^Puzhal/ },
  { name: "Cholavaram", re: /^Cholavaram/ },
  { name: "Chembarambakkam", re: /^Chembara/ },
  { name: "Thervoy Kandigai", re: /^Thervoy|^Kannankottai/ },
];

const $ = (id) => document.getElementById(id);

// ---- PDF text ----

async function inflate(bytes) {
  const ds = new DecompressionStream("deflate");
  const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}

const latin1 = (u8) => {
  let s = "";
  for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
  return s;
};

// Text items [{ x, y, text }] of every page.
export async function pdfText(buf) {
  const bytes = new Uint8Array(buf);
  const raw = latin1(bytes);
  const items = [];
  const re = /<<([^>]*?\/FlateDecode[^>]*?)>>\s*stream\r?\n/g;
  let m;
  let pageNo = 0;
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length;
    const len = Number(/\/Length (\d+)/.exec(m[1])?.[1]);
    const end = len > 0 ? start + len : raw.indexOf("endstream", start);
    if (end < start) break;
    let text;
    try {
      text = latin1(await inflate(bytes.subarray(start, end)));
    } catch {
      continue;
    }
    if (!text.includes("TJ") && !text.includes("Tj")) continue;
    const page = -1000 * pageNo++; // keep pages apart
    const stack = [];
    let dx = 0;
    let dy = 0;
    const ops = /(?<![\w.])q(?![\w])|(?<![\w.])Q(?![\w])|1 0 0 1 (-?[\d.]+) (-?[\d.]+) cm|(-?[\d.]+) (-?[\d.]+) Td|\[((?:\\.|[^\]])*)\]\s*TJ|\(((?:\\.|[^)])*)\)\s*Tj/g;
    let x = 0;
    let y = 0;
    let o;
    while ((o = ops.exec(text))) {
      if (o[0] === "q") stack.push([dx, dy]);
      else if (o[0] === "Q") [dx, dy] = stack.pop() || [0, 0];
      else if (o[1] !== undefined) {
        dx += Number(o[1]);
        dy += Number(o[2]);
      } else if (o[3] !== undefined) {
        x = Number(o[3]) + dx;
        y = Number(o[4]) + dy;
      } else {
        const body = o[5] ?? `(${o[6]})`;
        const str = [...body.matchAll(/\(((?:\\.|[^)])*)\)/g)]
          .map((p) => p[1].replace(/\\([()\\])/g, "$1"))
          .join("");
        if (str.trim()) items.push({ x, y: y + page, text: str.trim() });
      }
    }
  }
  return items;
}

// { Poondi: [storage mcft, capacity mcft], … } for the Chennai lakes, or null.
export function chennaiLakes(items) {
  const out = {};
  for (const lake of LAKES) {
    const name = items.find((i) => lake.re.test(i.text) && i.x > 150 && i.x < 280);
    if (!name) continue;
    const nums = items
      .filter((i) => Math.abs(i.y - name.y) < 2 && i.x > name.x + 20 && /^-?[\d.]+$/.test(i.text))
      .sort((a, b) => a.x - b.x)
      .map((i) => Number(i.text));
    // depth, capacity, current depth, storage, percent
    if (nums.length >= 4 && nums[1] > 0) out[lake.name] = [nums[3], nums[1]];
  }
  return Object.keys(out).length >= 3 ? out : null;
}

// ---- Days ----

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const fileDay = (day) => day.split("-").reverse().join("-");
const today = () => iso(new Date(Date.now() + 5.5 * 3600 * 1000));
function shift(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}
const lastYear = (day) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return iso(d);
};

function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(SAVED_KEY)) || {};
  } catch {
    return {};
  }
}
function save(all) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(all));
  } catch {}
}

async function readDay(day) {
  const res = await fetch(`${BASE}reservoir_${fileDay(day)}.pdf`);
  if (res.status === 404) return 0;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return chennaiLakes(await pdfText(await res.arrayBuffer())) || 0;
}

// ---- Screen ----

let range = 30;
let run = 0;
let shownDays = null;

const totalOf = (d) => (d ? Object.values(d).reduce((a, [s]) => a + s, 0) : null);
const capOf = (d) => (d ? Object.values(d).reduce((a, [, c]) => a + c, 0) : null);
// TMC shown as mcft (as Metro Water does).
const fmt = (v) => (typeof v === "number" ? Math.round(v * 1000).toLocaleString("en-IN") : "–");
const nice = (day) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

async function load() {
  const my = ++run;
  const status = $("lk-status");
  const end = today();
  const days = Array.from({ length: range }, (_, i) => shift(end, i - range + 1));
  const want = [...days, ...days.map(lastYear)];
  const all = loadSaved();
  // Today's report may not be out yet; a missing recent day is retried.
  const need = want.filter((d) => !(d in all) || (all[d] === 0 && d >= shift(end, -3)));
  let done = 0;
  if (need.length) status.textContent = `Reading ${need.length} daily reports (about ${Math.max(1, Math.round(need.length * 0.03))} MB)…`;
  let next = 0;
  let failed = 0;
  const worker = async () => {
    while (next < need.length) {
      const d = need[next++];
      try {
        all[d] = await readDay(d);
      } catch {
        failed++;
      }
      done++;
      if (my === run && done % 5 === 0) status.textContent = `Reading daily reports… ${done} of ${need.length}`;
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  if (my !== run) return;
  save(all);
  shownDays = { days, all };
  draw();
  const last = [...days].reverse().find((d) => all[d]);
  status.textContent = last
    ? `TN-SMART daily reservoir report, latest ${nice(last)}` + (failed ? ` · ${failed} days couldn't be read` : "")
    : failed
      ? "Couldn't reach TN-SMART's reservoir reports. Check the connection and try again."
      : "No reservoir reports for these days.";
  status.className = last ? "status" : "status error";
}

function draw() {
  if (!shownDays) return;
  const { days, all } = shownDays;
  const lake = $("lk-lake").value;
  const pick = (d) => {
    const v = all[d];
    if (!v) return null;
    if (lake === "all") return totalOf(v);
    return v[lake] ? v[lake][0] : null;
  };
  // In TMC (1,000 mcft), so the axis labels stay short.
  const tmc = (v) => (typeof v === "number" ? v / 1000 : null);
  const now = days.map(pick).map(tmc);
  const before = days.map((d) => pick(lastYear(d))).map(tmc);
  const cap = (() => {
    const d = [...days].reverse().find((x) => all[x]);
    if (!d) return null;
    return tmc(lake === "all" ? capOf(all[d]) : all[d][lake]?.[1] ?? null);
  })();
  const top = cap ? [0.1, 0.125, 0.25, 0.5, 0.75, 1, 1.25, 2, 2.5, 3, 4, 5].find((s) => s * 4 >= cap) * 4 : undefined;
  const every = Math.ceil(days.length / 6);
  drawLines(
    $("lk-chart"),
    $("lk-readout"),
    {
      count: days.length,
      series: [
        { values: before, cls: "last-year" },
        { values: now, cls: "this-year" },
      ],
      ticks: days.map((d, i) => ({ at: i, label: nice(d) })).filter((_, i) => (days.length - 1 - i) % every === 0),
      points: days.map((d, i) => ({
        at: i,
        text:
          `${nice(d)}: ${fmt(now[i])} mcft` +
          (typeof now[i] === "number" && cap ? ` (${Math.round((100 * now[i]) / cap)}%)` : "") +
          ` · a year before ${fmt(before[i])} mcft`,
      })),
    },
    "Tap the chart for a day.",
    { unit: "TMC", min: 0, max: top }
  );
  const li = now.findLastIndex((v) => typeof v === "number");
  const fi = now.findIndex((v) => typeof v === "number");
  const parts = [];
  if (li >= 0) {
    parts.push(`${fmt(now[li])} mcft on ${nice(days[li])}${cap ? `, ${Math.round((100 * now[li]) / cap)}% of ${fmt(cap)}` : ""}`);
    if (fi >= 0 && fi < li) {
      const ch = now[li] - now[fi];
      parts.push(`${ch >= 0 ? "up" : "down"} ${fmt(Math.abs(ch))} mcft in ${li - fi} days`);
    }
    if (typeof before[li] === "number") {
      const diff = now[li] - before[li];
      parts.push(`${fmt(Math.abs(diff))} mcft ${diff >= 0 ? "more" : "less"} than a year ago (${fmt(before[li])})`);
    }
  }
  $("lk-summary").textContent = parts.join(" · ");
}

export function initLakeTrend() {
  try {
    const r = Number(localStorage.getItem(RANGE_KEY));
    if (r === 30 || r === 90) range = r;
  } catch {}
  const lakePick = $("lk-lake");
  lakePick.replaceChildren(new Option("All five lakes", "all"), ...LAKES.map((l) => new Option(l.name, l.name)));
  lakePick.addEventListener("change", draw);
  const paint = () => {
    for (const b of document.querySelectorAll("#lk-range button")) b.setAttribute("aria-pressed", String(Number(b.dataset.days) === range));
  };
  paint();
  for (const b of document.querySelectorAll("#lk-range button"))
    b.addEventListener("click", () => {
      range = Number(b.dataset.days);
      try {
        localStorage.setItem(RANGE_KEY, String(range));
      } catch {}
      paint();
      load();
    });
}

let loadedAt = 0;
export function showLakeTrend(force = false) {
  if (!force && Date.now() - loadedAt < 30 * 60 * 1000) return;
  loadedAt = Date.now();
  load();
}
