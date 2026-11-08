// Rain spell (#spell): one screen for a spell of rain in a district (Chennai
// by default) or all Tamil Nadu: the total, rain each day, the wettest TN
// rain gauges, a map of every gauge's total, the radar, and which flood spots
// had the most rain near them. "Share" sends it all as one picture.
//
// The spell is found from the TN-SMART gauges (js/gaugedays.js): the latest
// run of rain days with at least 2.5 mm on average over the area, looking back
// two weeks. The dates can be changed by hand.
//
// IMD keeps only the last 3 hours of radar, so the radar shown is the latest
// one: its 3-hour loop while the spell is still going, otherwise the latest
// picture (marked as such).
import { getDays, daysEnding, currentRainDay, niceDay } from "./gaugedays.js";
import { drawBars } from "./chart.js";
import { FLOOD_SPOTS } from "./flood-spots.js";
import { km, riskOf } from "./floods.js";
import { RADARS } from "./radarmap.js";
import { radarImageUrl, radarAnimationUrl } from "./stations.js";
import { shareButton, shareName } from "./share.js";
import { routeParams } from "./route.js";

const AREA_KEY = "myweather.spell.area";
const LOOK_BACK = 14;
const WET = 2.5; // mm area average for a day to count as part of a spell
const NEAR_KM = 6;

// Spell totals, mm.
const SCALE = [
  [1, "#9aa4af", "< 1"],
  [25, "#9fd3ff", "1–25"],
  [50, "#4aa3ff", "25–50"],
  [100, "#1565c0", "50–100"],
  [200, "#7b1fa2", "100–200"],
  [300, "#c2185b", "200–300"],
  [Infinity, "#b71c1c", "300+"],
];
const colourOf = (v) => (typeof v === "number" ? SCALE.find(([max]) => v < max)[1] : "#9aa4af");

const DISTRICTS = [
  "Ariyalur", "Chengalpattu", "Chennai", "Coimbatore", "Cuddalore", "Dharmapuri", "Dindigul", "Erode",
  "Kallakurichi", "Kancheepuram", "Kanniyakumari", "Karur", "Krishnagiri", "Madurai", "Mayiladuthurai",
  "Nagapattinam", "Namakkal", "Nilgiris", "Perambalur", "Pudukkottai", "Ramanathapuram", "Ranipet", "Salem",
  "Sivagangai", "Tenkasi", "Thanjavur", "Theni", "Thiruchirappalli", "Thiruvarur", "Thoothukudi", "Tirunelveli",
  "Tirupathur", "Tiruppur", "Tiruvallur", "Tiruvannamalai", "Vellore", "Villupuram", "Virudhunagar",
];

const $ = (id) => document.getElementById(id);
const status = $("sp-status");
const areaPick = $("sp-area");
const fromInput = $("sp-from");
const toInput = $("sp-to");

let result = null; // the spell on screen
let run = 0;

function say(text, error = false) {
  status.textContent = text;
  status.className = error ? "status error" : "status";
}

const fmt = (v) => (typeof v === "number" ? (Math.round(v * 10) / 10).toFixed(v >= 100 || v % 1 === 0 ? 0 : 1) : "–");
const areaName = () => (areaPick.value === "all" ? "Tamil Nadu" : areaPick.value);
const inArea = (g) => areaPick.value === "all" || g[0] === areaPick.value;
const span = (a, b) => (a === b ? niceDay(a) : `${niceDay(a)} – ${niceDay(b)}`);

// Average day total over the area's reporting gauges.
function areaAverage(day) {
  if (!day) return null;
  const v = day.gauges.filter((g) => inArea(g) && typeof g[4] === "number").map((g) => g[4]);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

// ---- Finding the spell ----

async function findLatest() {
  const my = ++run;
  const end = currentRainDay();
  const days = daysEnding(end, LOOK_BACK);
  say("Looking for the latest spell of rain in the gauges of the last two weeks…");
  const got = await getDays(days, (done, total) => {
    if (my === run) say(`Looking for the latest spell… ${done} of ${total} days (about 0.7 MB each the first time)`);
  });
  if (my !== run) return;
  const avg = got.map(areaAverage);
  let last = avg.findLastIndex((v) => v >= WET);
  if (last < 0) {
    fromInput.value = days[days.length - 7];
    toInput.value = end;
    await build(days.slice(-7), got.slice(-7), my, `No day in the last two weeks had ${WET} mm on average in ${areaName()}. The last 7 days:`);
    return;
  }
  let first = last;
  while (first > 0 && avg[first - 1] >= WET) first--;
  // Keep a day of lighter rain on either side, as it's usually the same spell.
  if (first > 0 && avg[first - 1] >= 0.5) first--;
  if (last < days.length - 1 && avg[last + 1] >= 0.5) last++;
  fromInput.value = days[first];
  toInput.value = days[last];
  await build(days.slice(first, last + 1), got.slice(first, last + 1), my);
}

async function fromDates() {
  const my = ++run;
  let a = fromInput.value;
  let b = toInput.value;
  if (!a || !b) return say("Pick both dates.", true);
  if (a > b) [a, b] = [b, a];
  const n = Math.round((new Date(b) - new Date(a)) / 86400000) + 1;
  if (n > 31) return say("Pick at most 31 days.", true);
  const days = daysEnding(b, n);
  say(`Loading ${n} days…`);
  const got = await getDays(days, (done, total) => {
    if (my === run) say(`Loading… ${done} of ${total} days`);
  });
  if (my !== run) return;
  await build(days, got, my);
}

// ---- Summary ----

async function build(days, got, my, lead = "") {
  const gauges = new Map(); // key -> { district, name, lat, lon, total, days, wettestDay, wettestHour }
  got.forEach((d) => {
    if (!d) return;
    for (const g of d.gauges) {
      if (!inArea(g) || typeof g[4] !== "number") continue;
      const k = `${g[0]}|${g[1]}`;
      const e = gauges.get(k) || { district: g[0], name: g[1], lat: g[2], lon: g[3], total: 0, days: 0, wettestDay: 0, wettestHour: 0 };
      e.total += g[4];
      e.days++;
      e.wettestDay = Math.max(e.wettestDay, g[4]);
      e.wettestHour = Math.max(e.wettestHour, g[5] || 0);
      gauges.set(k, e);
    }
  });
  const list = [...gauges.values()];
  const missingDays = got.filter((d) => !d || !d.gauges.length).length;
  if (!list.length) {
    result = null;
    render();
    return say(`No gauge data for ${span(days[0], days[days.length - 1])}.`, true);
  }
  const avgs = got.map(areaAverage);
  const total = list.reduce((a, g) => a + g.total, 0) / list.length;
  const top = [...list].sort((a, b) => b.total - a.total);
  // Flood spots near the area's gauges (Chennai's list).
  const spots = FLOOD_SPOTS.map((spot) => {
    let best = null;
    for (const g of list) {
      const d = km([spot.lat, spot.lon], [g.lat, g.lon]);
      if (d <= NEAR_KM && (!best || d < best.d)) best = { g, d };
    }
    return best && { spot, ...best, risk: riskOf(best.g.wettestDay, best.g.wettestHour) };
  })
    .filter(Boolean)
    .sort((a, b) => b.g.wettestDay - a.g.wettestDay);
  const running = days[days.length - 1] >= currentRainDay();
  const centre = list.reduce((a, g) => [a[0] + g.lat / list.length, a[1] + g.lon / list.length], [0, 0]);
  const radar = RADARS.map((r) => ({ r, d: km(centre, [r.lat, r.lon]) })).sort((a, b) => a.d - b.d)[0].r;
  result = {
    area: areaName(),
    days,
    avgs,
    total,
    gauges: list,
    top,
    spots,
    running,
    radar,
    heavy: list.filter((g) => g.wettestDay >= 64.5).length,
    over100: list.filter((g) => g.total >= 100).length,
  };
  if (my !== run) return;
  render();
  say(
    (lead ? `${lead} ` : "") +
      `${result.area}, rain days ${span(days[0], days[days.length - 1])} (each to 8:30 AM) · ${list.length} gauges` +
      (missingDays ? ` · ${missingDays} day${missingDays > 1 ? "s" : ""} without data` : "") +
      (running ? " · still going" : "")
  );
}

function stat(value, label) {
  const s = document.createElement("span");
  s.className = "strip-stat";
  s.innerHTML = "<b></b><small></small>";
  s.querySelector("b").textContent = value;
  s.querySelector("small").textContent = label;
  return s;
}

function render() {
  const r = result;
  $("sp-body").hidden = !r;
  if (!r) return;
  $("sp-title").textContent = `${r.area} · ${span(r.days[0], r.days[r.days.length - 1])}`;
  $("sp-stats").replaceChildren(
    stat(`${fmt(r.total)} mm`, "average"),
    stat(`${fmt(r.top[0].total)} mm`, "wettest gauge"),
    stat(String(r.over100), "gauges 100 mm+"),
    stat(String(r.heavy), "heavy-rain gauges")
  );
  $("sp-headline").textContent =
    `${r.days.length} day${r.days.length > 1 ? "s" : ""}: ${fmt(r.total)} mm on average over ${r.gauges.length} gauges, ` +
    `most at ${r.top[0].name} (${r.top[0].district}) with ${fmt(r.top[0].total)} mm.` +
    (r.heavy ? ` ${r.heavy} gauges had a day of heavy rain (64.5 mm or more).` : "");
  drawBars(
    $("sp-days"),
    $("sp-days-readout"),
    r.days.map((d, i) => ({
      tick: r.days.length <= 10 || i % 3 === 0 ? niceDay(d, { month: undefined }) : "",
      value: r.avgs[i] ?? null,
      partial: d >= currentRainDay(),
      text: `Rain day ending ${niceDay(d)}: ${fmt(r.avgs[i])} mm on average`,
    })),
    "Tap a bar for the day's average."
  );
  // Wettest gauges.
  const max = r.top[0].total || 1;
  $("sp-top").replaceChildren(
    ...r.top.slice(0, 10).map((g) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.className = "rank-row";
      a.href = `#gauges?gauge=${encodeURIComponent(`${g.district}|${g.name}`)}`;
      a.innerHTML = `<span class="rank-name"></span><span class="rank-val"></span><span class="rank-bar"><i></i></span>`;
      a.querySelector(".rank-name").textContent = r.area === "Tamil Nadu" ? `${g.name} · ${g.district}` : g.name;
      a.querySelector(".rank-val").textContent = `${fmt(g.total)} mm`;
      const bar = a.querySelector("i");
      bar.style.width = `${Math.max(1, (g.total / max) * 100)}%`;
      bar.style.background = colourOf(g.total);
      li.append(a);
      return li;
    })
  );
  drawMap($("sp-map"), r);
  $("sp-legend").replaceChildren(
    ...SCALE.map(([, c, label]) => {
      const s = document.createElement("span");
      s.style.setProperty("--level", c);
      s.textContent = label;
      return s;
    }),
    Object.assign(document.createElement("small"), { textContent: "mm in the spell" })
  );
  // Radar.
  const img = $("sp-radar");
  const loop = r.running ? radarAnimationUrl(r.radar.code, "caz") : null;
  img.src = loop || radarImageUrl(r.radar.code, "caz");
  $("sp-radar-link").href = `#radarmap?station=${r.radar.code}`;
  $("sp-radar-note").textContent = loop
    ? `${r.radar.name} radar, IMD's last 3 hours.`
    : `${r.radar.name} radar now. IMD keeps only the last 3 hours, so the radar of earlier days can't be shown.`;
  // Flood spots.
  const box = $("sp-floods");
  box.hidden = !r.spots.length;
  $("sp-flood-list").replaceChildren(
    ...r.spots.slice(0, 8).map((s) => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="spot"></span><span class="sp-flood-text"><b></b><small></small></span>`;
      const badge = li.querySelector(".spot");
      badge.className = `spot spot-${s.risk.id}${s.spot.kind === "subway" ? " spot-subway" : ""}`;
      badge.textContent = s.spot.kind === "subway" ? "U" : "!";
      li.querySelector("b").textContent = s.spot.name;
      li.querySelector("small").textContent =
        `${s.risk.label} · wettest day ${fmt(s.g.wettestDay)} mm, ${fmt(s.g.total)} mm in the spell at ${s.g.name} (${s.d.toFixed(1)} km)`;
      return li;
    })
  );
}

// ---- Map of the gauges (canvas, so it can go in the shared picture) ----

function frame(r) {
  const lats = r.gauges.map((g) => g.lat);
  const lons = r.gauges.map((g) => g.lon);
  const pad = 0.03;
  return { s: Math.min(...lats) - pad, n: Math.max(...lats) + pad, w: Math.min(...lons) - pad, e: Math.max(...lons) + pad };
}

function paintMap(ctx, r, x0, y0, w, h, dark) {
  const f = frame(r);
  const kx = Math.cos((((f.s + f.n) / 2) * Math.PI) / 180);
  const sx = w / ((f.e - f.w) * kx);
  const sy = h / (f.n - f.s);
  const s = Math.min(sx, sy);
  const ox = x0 + (w - (f.e - f.w) * kx * s) / 2;
  const oy = y0 + (h - (f.n - f.s) * s) / 2;
  const at = (lat, lon) => [ox + (lon - f.w) * kx * s, oy + (f.n - lat) * s];
  ctx.fillStyle = dark ? "#1b2430" : "#eef3f8";
  ctx.fillRect(x0, y0, w, h);
  // Light grid every 0.1° (or 0.5° for a big area).
  const stepDeg = f.n - f.s > 2 ? 0.5 : 0.1;
  ctx.strokeStyle = dark ? "rgba(255,255,255,.08)" : "rgba(0,0,0,.07)";
  ctx.lineWidth = 1;
  for (let lat = Math.ceil(f.s / stepDeg) * stepDeg; lat < f.n; lat += stepDeg) {
    const [, y] = at(lat, f.w);
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x0 + w, y);
    ctx.stroke();
  }
  for (let lon = Math.ceil(f.w / stepDeg) * stepDeg; lon < f.e; lon += stepDeg) {
    const [x] = at(f.s, lon);
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.lineTo(x, y0 + h);
    ctx.stroke();
  }
  const rad = Math.max(3, Math.min(9, Math.sqrt((w * h) / r.gauges.length) / 4));
  for (const g of [...r.gauges].sort((a, b) => a.total - b.total)) {
    const [x, y] = at(g.lat, g.lon);
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, 2 * Math.PI);
    ctx.fillStyle = colourOf(g.total);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,.4)";
    ctx.stroke();
  }
  // Mark the wettest gauge.
  const [tx, ty] = at(r.top[0].lat, r.top[0].lon);
  ctx.beginPath();
  ctx.arc(tx, ty, rad + 4, 0, 2 * Math.PI);
  ctx.strokeStyle = dark ? "#fff" : "#111";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.lineWidth = 1;
}

const isDark = () => {
  const t = document.documentElement.dataset.theme;
  return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
};

function drawMap(canvas, r) {
  const w = canvas.clientWidth || 360;
  const h = Math.round(w * 0.8);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  paintMap(ctx, r, 0, 0, w, h, isDark());
}

// ---- The shared picture ----

async function radarBitmap(r) {
  try {
    const res = await fetch(`${radarImageUrl(r.radar.code, "caz")}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    return await createImageBitmap(await res.blob());
  } catch {
    return null; // outside the app IMD blocks reading the picture
  }
}

async function sharePicture() {
  const r = result;
  if (!r) return null;
  const W = 1080;
  const radar = await radarBitmap(r);
  const spots = r.spots.slice(0, 5);
  const H = 150 + 130 + 300 + 60 + 10 * 44 + 40 + 700 + (spots.length ? 60 + spots.length * 44 : 0) + 70;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  const font = (size, weight = 400) => `${weight} ${size}px system-ui, -apple-system, Roboto, sans-serif`;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  // Header.
  ctx.fillStyle = "#1565c0";
  ctx.fillRect(0, 0, W, 150);
  ctx.fillStyle = "#fff";
  ctx.font = font(52, 700);
  ctx.fillText(`Rain spell · ${r.area}`, 40, 72);
  ctx.font = font(32);
  ctx.fillText(`${span(r.days[0], r.days[r.days.length - 1])} ${new Date(`${r.days[0]}T00:00:00Z`).getUTCFullYear()} · ${r.days.length} rain day${r.days.length > 1 ? "s" : ""}${r.running ? " (still going)" : ""}`, 40, 122);
  let y = 150;
  // Stats.
  const stats = [
    [`${fmt(r.total)} mm`, "average"],
    [`${fmt(r.top[0].total)} mm`, "wettest gauge"],
    [String(r.over100), "gauges 100 mm+"],
    [String(r.gauges.length), "gauges"],
  ];
  stats.forEach(([v, label], i) => {
    const cx = 40 + ((W - 80) / 4) * (i + 0.5);
    ctx.textAlign = "center";
    ctx.fillStyle = "#111";
    ctx.font = font(44, 700);
    ctx.fillText(v, cx, y + 70);
    ctx.fillStyle = "#5d6773";
    ctx.font = font(26);
    ctx.fillText(label, cx, y + 108);
  });
  ctx.textAlign = "left";
  y += 130;
  // Daily bars.
  ctx.fillStyle = "#111";
  ctx.font = font(30, 700);
  ctx.fillText("Average rain each day (mm)", 40, y + 34);
  const top = Math.max(1, ...r.avgs.filter((v) => typeof v === "number"));
  const bw = (W - 80) / r.days.length;
  r.days.forEach((d, i) => {
    const v = r.avgs[i] || 0;
    const bh = (v / top) * 150;
    const bx = 40 + bw * i + bw * 0.15;
    ctx.fillStyle = "#1565c0";
    ctx.fillRect(bx, y + 240 - bh, bw * 0.7, bh);
    ctx.fillStyle = "#111";
    ctx.textAlign = "center";
    ctx.font = font(22);
    if (v > 0) ctx.fillText(fmt(v), bx + bw * 0.35, y + 232 - bh);
    if (r.days.length <= 12 || i % 2 === 0) {
      ctx.fillStyle = "#5d6773";
      ctx.fillText(niceDay(d, { month: undefined }), bx + bw * 0.35, y + 272);
    }
    ctx.textAlign = "left";
  });
  y += 300;
  // Top gauges.
  ctx.fillStyle = "#111";
  ctx.font = font(30, 700);
  ctx.fillText("Wettest gauges (mm in the spell)", 40, y + 40);
  y += 60;
  const max = r.top[0].total || 1;
  r.top.slice(0, 10).forEach((g, i) => {
    const gy = y + i * 44;
    ctx.fillStyle = "#e3e8ee";
    ctx.fillRect(40, gy + 34, W - 200, 6);
    ctx.fillStyle = colourOf(g.total);
    ctx.fillRect(40, gy + 34, ((W - 200) * g.total) / max, 6);
    ctx.fillStyle = "#111";
    ctx.font = font(26);
    const name = r.area === "Tamil Nadu" ? `${g.name} · ${g.district}` : g.name;
    ctx.fillText(`${i + 1}. ${name}`.slice(0, 52), 40, gy + 26);
    ctx.textAlign = "right";
    ctx.font = font(26, 700);
    ctx.fillText(fmt(g.total), W - 40, gy + 30);
    ctx.textAlign = "left";
  });
  y += 10 * 44 + 40;
  // Map and radar side by side.
  const mapW = radar ? 600 : W - 80;
  paintMap(ctx, r, 40, y, mapW, 640, false);
  ctx.fillStyle = "#5d6773";
  ctx.font = font(22);
  ctx.fillText("Every gauge, coloured by its total (ringed: the wettest)", 40, y + 670);
  if (radar) {
    const rw = W - 80 - mapW - 20;
    const rh = (radar.height / radar.width) * rw;
    ctx.drawImage(radar, 40 + mapW + 20, y, rw, rh);
    ctx.fillText(`${r.radar.name} radar now (IMD)`, 40 + mapW + 20, y + rh + 30);
  }
  y += 700;
  if (spots.length) {
    ctx.fillStyle = "#111";
    ctx.font = font(30, 700);
    ctx.fillText("Flood spots with the most rain nearby", 40, y + 40);
    y += 60;
    const RISK_COLOUR = { high: "#e53935", watch: "#fb8c00", low: "#ffd54f", unknown: "#bdbdbd" };
    spots.forEach((s, i) => {
      const sy = y + i * 44;
      ctx.fillStyle = RISK_COLOUR[s.risk.id];
      ctx.beginPath();
      ctx.arc(56, sy + 21, 12, 0, 2 * Math.PI);
      ctx.fill();
      ctx.fillStyle = "#111";
      ctx.font = font(26);
      ctx.fillText(`${s.spot.name.slice(0, 38)} · ${s.risk.label}`, 80, sy + 30);
      ctx.textAlign = "right";
      ctx.font = font(26, 700);
      ctx.fillText(`${fmt(s.g.wettestDay)} mm/day`, W - 40, sy + 30);
      ctx.textAlign = "left";
    });
    y += spots.length * 44;
  }
  ctx.fillStyle = "#5d6773";
  ctx.font = font(22);
  ctx.fillText("MyWeather · rain from TN-SMART gauges (rain days to 8:30 AM IST) · radar: IMD", 40, H - 30);
  const blob = await new Promise((res) => c.toBlob(res, "image/png"));
  const text =
    `Rain spell in ${r.area}, ${span(r.days[0], r.days[r.days.length - 1])}: ${fmt(r.total)} mm on average, ` +
    `${fmt(r.top[0].total)} mm at ${r.top[0].name}.`;
  return { blob, name: shareName("rain-spell", "image/png"), text };
}

// ---- Screen ----

export function initSpell() {
  areaPick.replaceChildren(new Option("All Tamil Nadu", "all"), ...DISTRICTS.map((d) => new Option(d, d)));
  let saved = "Chennai";
  try {
    saved = localStorage.getItem(AREA_KEY) || saved;
  } catch {}
  areaPick.value = saved === "all" || DISTRICTS.includes(saved) ? saved : "Chennai";
  toInput.max = fromInput.max = currentRainDay();
  areaPick.addEventListener("change", () => {
    try {
      localStorage.setItem(AREA_KEY, areaPick.value);
    } catch {}
    findLatest();
  });
  $("sp-refresh").addEventListener("click", findLatest);
  $("sp-show").addEventListener("click", fromDates);
  shareButton($("sp-share"), sharePicture, say);
  window.addEventListener("resize", () => result && !$("view-spell").hidden && drawMap($("sp-map"), result));
}

let shownAt = 0;
export function showSpell() {
  // From Rain records: #spell?area=Chennai&from=2026-11-01&to=2026-11-04
  const q = routeParams();
  if (q.get("from") && q.get("to")) {
    const area = q.get("area");
    if (area && (area === "all" || DISTRICTS.includes(area))) areaPick.value = area;
    fromInput.value = q.get("from");
    toInput.value = q.get("to");
    shownAt = Date.now();
    history.replaceState(null, "", "#spell");
    fromDates();
    return;
  }
  if (result && Date.now() - shownAt < 15 * 60 * 1000) {
    drawMap($("sp-map"), result);
    return;
  }
  shownAt = Date.now();
  findLatest();
}
