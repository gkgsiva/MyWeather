// Morning digest (#digest): one picture summing up Chennai's weather for the
// day, to share on WhatsApp: the last rain day (TN-SMART gauges), today's and
// tomorrow's forecast (Open-Meteo), IMD's warnings, the lakes, the monsoon so
// far, sunrise and sunset, and the radar nowcast when there is a recent one.
//
// Every part loads on its own; a part that can't be reached says so and the
// rest still shows. The Share button sends the card as a picture with the
// same summary as text, so it reads well in a chat too.
import { getDay, currentRainDay, shiftDay, niceDay, imdDistrict } from "./gaugedays.js";
import { AREAS } from "./yoy.js";
import { FORECAST_URL, code } from "./forecast.js";
import { districtOutlook } from "./warnings.js";
import { latestLakes } from "./laketrend.js";
import { seasonByDistrict } from "./monsoon.js";
import { sunTimes } from "./astro.js";
import { loadNowcast, headline } from "./nowcast.js";
import { snapBlock } from "./snap.js";
import { shareImage, shareName } from "./share.js";
import { toTemp, matchDistrict } from "./prefs.js";

const AREA_KEY = "myweather.digest.area";
// IMD's warning map spells these districts differently from its rainfall pages.
const WARN_NAME = { RANIPET: "RANIPPETTAI", THIRUCHIRAPPALLI: "THIRUCHIRAPALLI", TUTICORIN: "THOOTHUKUDI", TIRUPATTUR: "TIRUPPATTAR" };
// Districts that draw water from the Chennai lakes.
const LAKE_AREAS = new Set(["CHENNAI", "THIRUVALLUR", "KANCHEEPURAM", "CHENGALPATTU", "KTCC"]);
const areaPick = document.getElementById("dg-area");
// "KTCC": Kancheepuram, Tiruvallur, Chennai and Chengalpattu side by side.
const KTCC = ["CHENNAI", "KANCHEEPURAM", "CHENGALPATTU", "THIRUVALLUR"];
const SHORT = { CHENNAI: "Chennai", KANCHEEPURAM: "Kanchi", CHENGALPATTU: "Chengalpet", THIRUVALLUR: "Tiruvallur" };
const toArea = (a) => ({ imd: a[0], name: a[1], short: SHORT[a[0]] || a[1], lat: a[2], lon: a[3] });
const isGroup = () => areaPick.value === "ktcc";
// The districts shown: one, or the KTCC four.
const areas = () =>
  isGroup() ? KTCC.map((n) => toArea(AREAS.find((a) => a[0] === n))) : [toArea(AREAS[Number(areaPick.value)] || AREAS[0])];
// The place the card is named after (KTCC: the group, at Chennai).
const area = () => (isGroup() ? { ...areas()[0], imd: "KTCC", name: "Chennai region (KTCC)" } : areas()[0]);
const TTL = 15 * 60 * 1000;

const $ = (id) => document.getElementById(id);
const card = $("dg-card");
const status = $("dg-status");

let loadedAt = 0;
let lines = {}; // part -> text, for the shared caption

const r0 = (v) => (typeof v === "number" ? String(Math.round(v)) : "–");
const mm = (v) => (typeof v !== "number" ? "–" : v < 10 ? (Math.round(v * 10) / 10).toString() : String(Math.round(v)));
const hm = (d) => (d ? d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "–");
const pct = (p) => (typeof p !== "number" ? "–" : `${p > 0 ? "+" : ""}${p}%`);

// One part of the card: icon, heading, body; body() fills it or throws.
function part(id, icon, title) {
  const sec = document.createElement("section");
  sec.className = "dg-part";
  sec.id = `dg-${id}`;
  sec.innerHTML = `<span class="dg-icon" aria-hidden="true"></span><div class="dg-text"><h3></h3><div class="dg-body"><small class="dg-wait">Loading…</small></div></div>`;
  sec.querySelector(".dg-icon").textContent = icon;
  sec.querySelector("h3").textContent = title;
  return sec;
}

function fill(id, html, text, cls = "") {
  const sec = $(`dg-${id}`);
  if (!sec) return;
  sec.className = `dg-part ${cls}`.trim();
  sec.querySelector(".dg-body").innerHTML = html;
  if (text) lines[id] = text;
  else delete lines[id];
}

function failed(id, why) {
  fill(id, `<small class="dg-wait">${why}</small>`, "", "dg-missing");
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// ---- Parts ----

async function rain() {
  const day = shiftDay(currentRainDay(), -1); // the last finished rain day
  const d = await getDay(day);
  const on = d.gauges.filter((g) => typeof g[4] === "number" && g[4] >= 0 && g[4] < 600);
  if (!on.length) throw new Error("no gauge data yet");
  const period0 = `${niceDay(shiftDay(day, -1))} 8:30 AM to ${niceDay(day)} 8:30 AM`;
  if (isGroup()) {
    const rows = areas().map((A) => {
      const g = on.filter((x) => imdDistrict(x[0]) === A.imd);
      const avg = g.length ? g.reduce((a, x) => a + x[4], 0) / g.length : null;
      const top = g.reduce((a, x) => (!a || x[4] > a[4] ? x : a), null);
      return { A, avg, top, n: g.length };
    });
    const best = rows.map((r) => r.top).filter(Boolean).reduce((a, x) => (!a || x[4] > a[4] ? x : a), null);
    fill(
      "rain",
      `<table class="dg-table"><tr><th></th><th>Average</th><th>Wettest gauge</th></tr>${rows
        .map((r) => `<tr><th>${esc(r.A.short)}</th><td><b>${mm(r.avg)}</b> mm</td><td>${r.top && r.top[4] > 0 ? `${esc(r.top[1])} ${mm(r.top[4])}` : "–"}</td></tr>`)
        .join("")}</table>
       ${best && best[4] > 0 ? `<p>Wettest in KTCC: <b>${esc(best[1])}</b> (${esc(best[0])}) ${mm(best[4])} mm</p>` : ""}
       <small>${period0} · TN-SMART gauges</small>`,
      `🌧️ Rain (${period0}): ` + rows.map((r) => `${r.A.short} ${mm(r.avg)} mm`).join(", ") + (best && best[4] > 0 ? `. Wettest ${best[1]} ${mm(best[4])} mm.` : "."),
      rows.some((r) => r.avg >= 15.6) ? "dg-wet" : ""
    );
    return;
  }
  const A = area();
  const ch = on.filter((g) => imdDistrict(g[0]) === A.imd);
  const avg = ch.length ? ch.reduce((a, g) => a + g[4], 0) / ch.length : null;
  const chTop = ch.reduce((a, g) => (!a || g[4] > a[4] ? g : a), null);
  const tnTop = on.reduce((a, g) => (!a || g[4] > a[4] ? g : a), null);
  const heavy = on.filter((g) => g[4] >= 64.5).length;
  const wet = ch.filter((g) => g[4] >= 0.1).length;
  const period = `${niceDay(shiftDay(day, -1))} 8:30 AM to ${niceDay(day)} 8:30 AM`;
  fill(
    "rain",
    `<p class="dg-big"><b>${mm(avg)} mm</b> <span>${esc(A.name)} average</span></p>
     <p>${chTop && chTop[4] > 0 ? `Wettest: <b>${esc(chTop[1])}</b> ${mm(chTop[4])} mm · rain at ${wet} of ${ch.length} gauges` : `No rain at ${esc(A.name)}'s ${ch.length} gauges`}</p>
     <p>Tamil Nadu: wettest <b>${esc(tnTop[1])}</b> (${esc(tnTop[0])}) ${mm(tnTop[4])} mm${heavy ? ` · ${heavy} gauges heavy (64.5 mm+)` : ""}</p>
     <small>${period} · TN-SMART gauges</small>`,
    `🌧️ Rain (${period}): ${A.name} avg ${mm(avg)} mm` +
      (chTop && chTop[4] > 0 ? `, wettest ${chTop[1]} ${mm(chTop[4])} mm` : "") +
      `. TN wettest ${tnTop[1]} (${tnTop[0]}) ${mm(tnTop[4])} mm.`,
    avg >= 15.6 ? "dg-wet" : ""
  );
}

async function forecastGroup() {
  const list = areas();
  const u = new URL(FORECAST_URL);
  u.searchParams.set("latitude", list.map((a) => a.lat).join(","));
  u.searchParams.set("longitude", list.map((a) => a.lon).join(","));
  const res = await fetch(u);
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.reason || `HTTP ${res.status}`);
  const all = Array.isArray(data) ? data : [data];
  const cell = (d, i) => `${code(d.weather_code[i])[0]} ${r0(toTemp(d.temperature_2m_max[i]))}° · ${r0(d.precipitation_probability_max[i])}%`;
  fill(
    "forecast",
    `<table class="dg-table"><tr><th></th><th>Today</th><th>Tomorrow</th></tr>${list
      .map((A, k) => `<tr><th>${esc(A.short)}</th><td>${cell(all[k].daily, 0)}</td><td>${cell(all[k].daily, 1)}</td></tr>`)
      .join("")}</table><small>Top temperature and chance of rain · Open-Meteo</small>`,
    "☁️ Today: " + list.map((A, k) => `${A.short} ${code(all[k].daily.weather_code[0])[0]} ${r0(all[k].daily.precipitation_probability_max[0])}%`).join(", ") +
      ". Tomorrow: " + list.map((A, k) => `${A.short} ${r0(all[k].daily.precipitation_probability_max[1])}%`).join(", ") + ".",
    all.some((x) => x.daily.precipitation_probability_max[0] >= 70) ? "dg-wet" : ""
  );
}

async function forecast() {
  if (isGroup()) return forecastGroup();
  const A = area();
  const u = new URL(FORECAST_URL);
  u.searchParams.set("latitude", A.lat);
  u.searchParams.set("longitude", A.lon);
  const res = await fetch(u);
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.reason || `HTTP ${res.status}`);
  const d = data.daily;
  const day = (i, label) => {
    const [icon, text] = code(d.weather_code[i]);
    return {
      html: `<div class="dg-day"><span class="dg-day-icon">${icon}</span><span><b>${label}</b> ${esc(text)}<br><small>${r0(toTemp(d.temperature_2m_max[i]))}° / ${r0(toTemp(d.temperature_2m_min[i]))}° · rain ${r0(d.precipitation_probability_max[i])}%, ${mm(d.precipitation_sum[i])} mm</small></span></div>`,
      text: `${label} ${icon} ${text}, ${r0(toTemp(d.temperature_2m_max[i]))}°/${r0(toTemp(d.temperature_2m_min[i]))}°, rain ${r0(d.precipitation_probability_max[i])}% (${mm(d.precipitation_sum[i])} mm)`,
    };
  };
  const t = day(0, "Today");
  const n = day(1, "Tomorrow");
  fill("forecast", t.html + n.html + `<small>Open-Meteo forecast for ${esc(A.name)}</small>`, `☁️ ${t.text}. ${n.text}.`, d.precipitation_probability_max[0] >= 70 ? "dg-wet" : "");
}

async function warningsGroup() {
  const list = areas();
  const all = await Promise.all(list.map((A) => districtOutlook(WARN_NAME[A.imd] || A.imd)));
  const dot = (r) => (r ? `<span class="dg-dot" style="background:${r.color}" title="${esc(r.levelName)}"></span>` : "–");
  const what = (r) => (r?.level ? esc(r.text || r.levelName) : "");
  const top = Math.max(...all.flatMap((o) => [o.now?.level || 0, o.today?.level || 0, o.tomorrow?.level || 0]));
  fill(
    "warn",
    `<table class="dg-table"><tr><th></th><th>Now</th><th>Today</th><th>Tomorrow</th></tr>${list
      .map((A, k) => `<tr><th>${esc(A.short)}</th><td>${dot(all[k].now)}</td><td>${dot(all[k].today)}</td><td>${dot(all[k].tomorrow)}</td></tr>`)
      .join("")}</table>` +
      [...new Set(all.flatMap((o) => [what(o.now), what(o.today), what(o.tomorrow)]).filter(Boolean))].map((t) => `<p>${t}</p>`).join("") +
      "<small>IMD district warnings · green none, yellow be aware, orange be prepared, red take action</small>",
    "⚠️ IMD today: " + list.map((A, k) => `${A.short} ${all[k].today?.level ? all[k].today.levelName.split(" ")[0] : "none"}`).join(", ") +
      ". Tomorrow: " + list.map((A, k) => `${A.short} ${all[k].tomorrow?.level ? all[k].tomorrow.levelName.split(" ")[0] : "none"}`).join(", ") + ".",
    top >= 2 ? "dg-alert" : top === 1 ? "dg-watch" : ""
  );
}

async function warnings() {
  if (isGroup()) return warningsGroup();
  const A = area();
  const o = await districtOutlook(WARN_NAME[A.imd] || A.imd);
  const row = (label, r) =>
    r
      ? `<p><span class="dg-dot" style="background:${r.color}"></span><b>${label}:</b> ${esc(r.level ? r.text || r.levelName : "No warning")}${r.level ? ` <small>(${esc(r.levelName)})</small>` : ""}</p>`
      : "";
  const top = Math.max(o.now?.level || 0, o.today?.level || 0, o.tomorrow?.level || 0);
  fill(
    "warn",
    row("Next 3 hours", o.now) + row("Today", o.today) + row("Tomorrow", o.tomorrow) + `<small>IMD district warnings, ${esc(A.name)}</small>`,
    (o.now?.level ? `⚠️ Next 3 hours: ${o.now.text || o.now.levelName}. ` : "") +
    `⚠️ IMD ${A.name}: today ${o.today?.level ? `${o.today.levelName} – ${o.today.text}` : "no warning"}; tomorrow ${o.tomorrow?.level ? `${o.tomorrow.levelName} – ${o.tomorrow.text}` : "no warning"}.`,
    top >= 2 ? "dg-alert" : top === 1 ? "dg-watch" : ""
  );
}

async function lakes() {
  const l = await latestLakes();
  if (!l) throw new Error("no recent reservoir report");
  const p = Math.round((l.storage / l.capacity) * 100);
  const rows = Object.entries(l.lakes)
    .map(([name, [s, c]]) => `<span>${esc(name.replace(/ \(.*\)/, ""))} <b>${Math.round((s / c) * 100)}%</b></span>`)
    .join("");
  fill(
    "lakes",
    `<p class="dg-big"><b>${p}%</b> <span>full · ${Math.round(l.storage).toLocaleString("en-IN")} of ${Math.round(l.capacity).toLocaleString("en-IN")} mcft</span></p>
     <div class="dg-meter"><i style="width:${Math.min(100, p)}%"></i></div>
     <p class="dg-lakes">${rows}</p>
     <small>TN-SMART reservoir report, ${niceDay(l.day)}</small>`,
    `💧 Chennai lakes ${p}% full (${niceDay(l.day)}).`
  );
}

async function monsoon() {
  const page = await seasonByDistrict();
  if (isGroup()) {
    const list = areas().map((A) => ({ A, a: page.areas[A.imd] }));
    fill(
      "monsoon",
      `<table class="dg-table"><tr><th></th><th>Actual</th><th>Normal</th><th></th></tr>${list
        .map(({ A, a }) => `<tr><th>${esc(A.short)}</th><td><b>${mm(a?.actual)}</b></td><td>${mm(a?.normal)}</td><td>${pct(a?.departure)}</td></tr>`)
        .join("")}</table><small>mm since 1 Oct · IMD${page.date ? `, to ${page.date.split("-").reverse().join("-")}` : ""}</small>`,
      "📈 NE monsoon so far: " + list.map(({ A, a }) => `${A.short} ${mm(a?.actual)} mm (${pct(a?.departure)})`).join(", ") + "."
    );
    return;
  }
  const A = area();
  const a = page.areas[A.imd];
  if (!a) throw new Error(`no figure for ${A.name}`);
  fill(
    "monsoon",
    `<p class="dg-big"><b>${mm(a.actual)} mm</b> <span>since 1 Oct · normal ${mm(a.normal)} mm</span></p><p><b>${pct(a.departure)}</b> against normal</p><small>IMD, ${esc(A.name)} district${page.date ? `, to ${page.date.split("-").reverse().join("-")}` : ""}</small>`,
    `📈 NE monsoon so far: ${A.name} ${mm(a.actual)} mm vs normal ${mm(a.normal)} mm (${pct(a.departure)}).`
  );
}

function sky() {
  const s = sunTimes(new Date(), area().lat, area().lon);
  fill("sky", `<p>Sunrise <b>${hm(s.sunrise)}</b> · sunset <b>${hm(s.sunset)}</b></p>`, `🌅 Sunrise ${hm(s.sunrise)}, sunset ${hm(s.sunset)}.`);
}

function nowcast() {
  const n = loadNowcast();
  const sec = $("dg-nowcast");
  if (!n || Date.now() - n.at > 30 * 60 * 1000 || (!["CHENNAI", "KTCC"].includes(area().imd) && n.place === "Chennai")) {
    sec.hidden = true;
    delete lines.nowcast;
    return;
  }
  sec.hidden = false;
  fill("nowcast", `<p><b>${esc(headline(n.result))}</b></p><small>${esc(n.place)} · from the ${esc(n.radar)} radar loop</small>`, `📡 ${n.place}: ${headline(n.result)}`);
}

// ---- Screen ----

function build() {
  const now = new Date();
  $("dg-title").textContent = `${area().name} weather today`;
  $("dg-date").textContent = now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const body = $("dg-parts");
  body.replaceChildren(
    part("warn", "⚠️", "Warnings"),
    part("nowcast", "📡", "Rain coming?"),
    part("forecast", "☁️", "Forecast"),
    part("rain", "🌧️", "Rain in the last 24 hours"),
    part("monsoon", "📈", "Monsoon so far"),
    ...(LAKE_AREAS.has(area().imd) ? [part("lakes", "💧", "Chennai lakes")] : []),
    part("sky", "🌅", "Sun")
  );
}

async function refresh() {
  lines = {};
  build();
  sky();
  nowcast();
  status.textContent = "Loading…";
  status.className = "status";
  const jobs = [
    ["warn", warnings, "IMD's warnings"],
    ["forecast", forecast, "the forecast"],
    ["rain", rain, "the rain gauges"],
    ["monsoon", monsoon, "IMD's monsoon figures"],
    ["lakes", lakes, "the lakes report"],
  ].filter(([id]) => id !== "lakes" || LAKE_AREAS.has(area().imd));
  const results = await Promise.allSettled(jobs.map(([, fn]) => fn()));
  const missing = [];
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      const [id, , what] = jobs[i];
      failed(id, `Couldn't load ${what} just now.`);
      missing.push(what);
    }
  });
  loadedAt = Date.now();
  status.textContent = missing.length ? `Ready, without ${missing.join(", ")}.` : "Ready to share.";
  status.className = missing.length ? "status error" : "status";
}

const ORDER = ["warn", "nowcast", "forecast", "rain", "monsoon", "lakes", "sky"];

/** The digest as plain text, for the chat message under the picture. */
export function digestText(parts = lines, date = new Date()) {
  const head = `*${area().name} weather · ${date.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}*`;
  return [head, ...ORDER.filter((k) => parts[k]).map((k) => parts[k]), "— shared from MyWeather"].join("\n");
}

async function share() {
  const btn = $("dg-share");
  btn.disabled = true;
  try {
    const title = `Morning digest · ${area().name} · ${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`;
    const blob = await snapBlock(card, title);
    const how = await shareImage({ blob, name: shareName("digest", "image/png"), text: digestText() });
    if (how === "downloaded") status.textContent = "Sharing isn't available here, so the picture was downloaded.";
  } catch (e) {
    status.textContent = `Couldn't make the picture (${e.message || e}).`;
    status.className = "status error";
  } finally {
    btn.disabled = false;
  }
}

export function initDigest() {
  areaPick.replaceChildren(new Option("KTCC (Chennai, Kanchi, Chengalpet, Tiruvallur)", "ktcc"), ...AREAS.map((a, i) => new Option(a[1], String(i))));
  // Unless picked here, the home district from Settings.
  areaPick.value = matchDistrict(areaPick.options) ?? "0";
  try {
    const saved = localStorage.getItem(AREA_KEY);
    if (saved === "ktcc" || (saved && AREAS[Number(saved)])) areaPick.value = saved;
  } catch {}
  areaPick.addEventListener("change", () => {
    try {
      localStorage.setItem(AREA_KEY, areaPick.value);
    } catch {}
    refresh();
  });
  $("dg-refresh").addEventListener("click", refresh);
  $("dg-share").addEventListener("click", share);
}

export function showDigest() {
  if (Date.now() - loadedAt > TTL) refresh();
  else nowcast();
}
