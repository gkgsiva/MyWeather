// Morning digest (#digest): one picture summing up Chennai's weather for the
// day, to share on WhatsApp: the last rain day (TN-SMART gauges), today's and
// tomorrow's forecast (Open-Meteo), IMD's warnings, the lakes, the monsoon so
// far, sunrise and sunset, and the radar nowcast when there is a recent one.
//
// Every part loads on its own; a part that can't be reached says so and the
// rest still shows. The Share button sends the card as a picture with the
// same summary as text, so it reads well in a chat too.
import { getDay, currentRainDay, shiftDay, niceDay } from "./gaugedays.js";
import { FORECAST_URL, code } from "./forecast.js";
import { districtOutlook } from "./warnings.js";
import { latestLakes } from "./laketrend.js";
import { seasonByDistrict } from "./monsoon.js";
import { sunTimes } from "./astro.js";
import { loadNowcast, headline } from "./nowcast.js";
import { snapBlock } from "./snap.js";
import { shareImage, shareName } from "./share.js";

const CHENNAI = { lat: 13.08, lon: 80.27 };
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
  const ch = on.filter((g) => g[0] === "Chennai");
  const avg = ch.length ? ch.reduce((a, g) => a + g[4], 0) / ch.length : null;
  const chTop = ch.reduce((a, g) => (!a || g[4] > a[4] ? g : a), null);
  const tnTop = on.reduce((a, g) => (!a || g[4] > a[4] ? g : a), null);
  const heavy = on.filter((g) => g[4] >= 64.5).length;
  const wet = ch.filter((g) => g[4] >= 0.1).length;
  const period = `${niceDay(shiftDay(day, -1))} 8:30 AM to ${niceDay(day)} 8:30 AM`;
  fill(
    "rain",
    `<p class="dg-big"><b>${mm(avg)} mm</b> <span>Chennai average</span></p>
     <p>${chTop && chTop[4] > 0 ? `Wettest: <b>${esc(chTop[1])}</b> ${mm(chTop[4])} mm · rain at ${wet} of ${ch.length} gauges` : `No rain at Chennai's ${ch.length} gauges`}</p>
     <p>Tamil Nadu: wettest <b>${esc(tnTop[1])}</b> (${esc(tnTop[0])}) ${mm(tnTop[4])} mm${heavy ? ` · ${heavy} gauges heavy (64.5 mm+)` : ""}</p>
     <small>${period} · TN-SMART gauges</small>`,
    `🌧️ Rain (${period}): Chennai avg ${mm(avg)} mm` +
      (chTop && chTop[4] > 0 ? `, wettest ${chTop[1]} ${mm(chTop[4])} mm` : "") +
      `. TN wettest ${tnTop[1]} (${tnTop[0]}) ${mm(tnTop[4])} mm.`,
    avg >= 15.6 ? "dg-wet" : ""
  );
}

async function forecast() {
  const res = await fetch(FORECAST_URL);
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.reason || `HTTP ${res.status}`);
  const d = data.daily;
  const day = (i, label) => {
    const [icon, text] = code(d.weather_code[i]);
    return {
      html: `<div class="dg-day"><span class="dg-day-icon">${icon}</span><span><b>${label}</b> ${esc(text)}<br><small>${r0(d.temperature_2m_max[i])}° / ${r0(d.temperature_2m_min[i])}° · rain ${r0(d.precipitation_probability_max[i])}%, ${mm(d.precipitation_sum[i])} mm</small></span></div>`,
      text: `${label} ${icon} ${text}, ${r0(d.temperature_2m_max[i])}°/${r0(d.temperature_2m_min[i])}°, rain ${r0(d.precipitation_probability_max[i])}% (${mm(d.precipitation_sum[i])} mm)`,
    };
  };
  const t = day(0, "Today");
  const n = day(1, "Tomorrow");
  fill("forecast", t.html + n.html + "<small>Open-Meteo forecast for Chennai</small>", `☁️ ${t.text}. ${n.text}.`, d.precipitation_probability_max[0] >= 70 ? "dg-wet" : "");
}

async function warnings() {
  const o = await districtOutlook("CHENNAI");
  const row = (label, r) =>
    r
      ? `<p><span class="dg-dot" style="background:${r.color}"></span><b>${label}:</b> ${esc(r.level ? r.text || r.levelName : "No warning")}${r.level ? ` <small>(${esc(r.levelName)})</small>` : ""}</p>`
      : "";
  const top = Math.max(o.now?.level || 0, o.today?.level || 0, o.tomorrow?.level || 0);
  fill(
    "warn",
    row("Next 3 hours", o.now) + row("Today", o.today) + row("Tomorrow", o.tomorrow) + "<small>IMD district warnings, Chennai</small>",
    (o.now?.level ? `⚠️ Next 3 hours: ${o.now.text || o.now.levelName}. ` : "") +
    `⚠️ IMD Chennai: today ${o.today?.level ? `${o.today.levelName} – ${o.today.text}` : "no warning"}; tomorrow ${o.tomorrow?.level ? `${o.tomorrow.levelName} – ${o.tomorrow.text}` : "no warning"}.`,
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
  const a = page.areas.CHENNAI;
  if (!a) throw new Error("no figure for Chennai");
  fill(
    "monsoon",
    `<p class="dg-big"><b>${mm(a.actual)} mm</b> <span>since 1 Oct · normal ${mm(a.normal)} mm</span></p><p><b>${pct(a.departure)}</b> against normal</p><small>IMD, Chennai district${page.date ? `, to ${page.date.split("-").reverse().join("-")}` : ""}</small>`,
    `📈 NE monsoon so far: Chennai ${mm(a.actual)} mm vs normal ${mm(a.normal)} mm (${pct(a.departure)}).`
  );
}

function sky() {
  const s = sunTimes(new Date(), CHENNAI.lat, CHENNAI.lon);
  fill("sky", `<p>Sunrise <b>${hm(s.sunrise)}</b> · sunset <b>${hm(s.sunset)}</b></p>`, `🌅 Sunrise ${hm(s.sunrise)}, sunset ${hm(s.sunset)}.`);
}

function nowcast() {
  const n = loadNowcast();
  const sec = $("dg-nowcast");
  if (!n || Date.now() - n.at > 30 * 60 * 1000) {
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
  $("dg-date").textContent = now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const body = $("dg-parts");
  body.replaceChildren(
    part("warn", "⚠️", "Warnings"),
    part("nowcast", "📡", "Rain coming?"),
    part("forecast", "☁️", "Forecast"),
    part("rain", "🌧️", "Rain in the last 24 hours"),
    part("monsoon", "📈", "Monsoon so far"),
    part("lakes", "💧", "Chennai lakes"),
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
  ];
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
  const head = `*Chennai weather · ${date.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}*`;
  return [head, ...ORDER.filter((k) => parts[k]).map((k) => parts[k]), "— shared from MyWeather"].join("\n");
}

async function share() {
  const btn = $("dg-share");
  btn.disabled = true;
  try {
    const title = `Morning digest · Chennai · ${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`;
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
  $("dg-refresh").addEventListener("click", refresh);
  $("dg-share").addEventListener("click", share);
}

export function showDigest() {
  if (Date.now() - loadedAt > TTL) refresh();
  else nowcast();
}
