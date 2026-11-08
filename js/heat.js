// Heat & humidity (#heat): how hot it feels, now and through the next two
// days, and how much strain that puts on the body.
//
// "Feels like" here is the heat index (US National Weather Service formula,
// the one IMD's heat index also uses): air temperature and humidity together.
// Wet-bulb temperature (Stull's formula) is shown too: above about 31 °C the
// body struggles to cool itself by sweating even in the shade.
//
// Forecast hours from Open-Meteo (no key), for the phone's place when Home's
// "Near you" is on, else Chennai. The home station's latest reading, when the
// app has one, gives the heat index measured right now.
import { drawLines } from "./chart.js";
import { when } from "./offline.js";
import { AREAS } from "./yoy.js";
import { km } from "./floods.js";

const CHENNAI = { lat: 13.0827, lon: 80.2707, name: "Chennai" };
const SAVED_KEY = "myweather.heat.last";
const TTL = 20 * 60 * 1000;

const $ = (id) => document.getElementById(id);
const status = $("heat-status");

let loadedAt = 0;

// ---- Formulas ----

/** Heat index in °C from air temperature (°C) and relative humidity (%). */
export function heatIndex(t, rh) {
  if (typeof t !== "number" || typeof rh !== "number") return null;
  const f = (t * 9) / 5 + 32;
  let hi = 0.5 * (f + 61 + (f - 68) * 1.2 + rh * 0.094);
  if ((hi + f) / 2 >= 80) {
    hi =
      -42.379 + 2.04901523 * f + 10.14333127 * rh - 0.22475541 * f * rh - 0.00683783 * f * f - 0.05481717 * rh * rh +
      0.00122874 * f * f * rh + 0.00085282 * f * rh * rh - 0.00000199 * f * f * rh * rh;
    if (rh < 13 && f >= 80 && f <= 112) hi -= ((13 - rh) / 4) * Math.sqrt((17 - Math.abs(f - 95)) / 17);
    else if (rh > 85 && f >= 80 && f <= 87) hi += ((rh - 85) / 10) * ((87 - f) / 5);
  }
  // Below about 27 °C the index is just the air temperature.
  return Math.max(t, ((hi - 32) * 5) / 9);
}

/** Wet-bulb temperature in °C (Stull 2011), good for 5–99% humidity. */
export function wetBulb(t, rh) {
  if (typeof t !== "number" || typeof rh !== "number") return null;
  return (
    t * Math.atan(0.151977 * Math.sqrt(rh + 8.313659)) +
    Math.atan(t + rh) -
    Math.atan(rh - 1.676331) +
    0.00391838 * rh ** 1.5 * Math.atan(0.023101 * rh) -
    4.686035
  );
}

// Heat stress by heat index (°C), as the US weather service bands it.
export const LEVELS = [
  { max: 27, name: "Comfortable", cls: "ok", color: "#2e7d32", advice: "No heat strain for most people." },
  { max: 32, name: "Caution", cls: "caution", color: "#f2c200", advice: "Tiring with long exposure or hard work. Drink water." },
  {
    max: 41,
    name: "Extreme caution",
    cls: "xcaution",
    color: "#f57c00",
    advice: "Heat cramps and exhaustion possible. Rest in shade, drink often, avoid noon sun.",
  },
  { max: 54, name: "Danger", cls: "danger", color: "#d32f2f", advice: "Heat exhaustion likely, heat stroke possible. Avoid hard work outdoors." },
  { max: Infinity, name: "Extreme danger", cls: "xdanger", color: "#7b1111", advice: "Heat stroke likely. Stay in a cool place." },
];
export const levelOf = (hi) => (typeof hi === "number" ? LEVELS.find((l) => hi < l.max) : null);

// ---- Data ----

// ---- Place: a district, the phone's position, or a searched place or pincode ----

const PLACE_KEY = "myweather.heat.place"; // { lat, lon, name } or absent (automatic)
const placePick = $("heat-area");

function gpsPlace() {
  try {
    const on = JSON.parse(localStorage.getItem("myweather.home.gps")) === true;
    const pos = on && JSON.parse(localStorage.getItem("myweather.home.pos"));
    if (pos && typeof pos.lat === "number") return { lat: pos.lat, lon: pos.lon, name: "Your location" };
  } catch {}
  return null;
}

function place() {
  try {
    const p = JSON.parse(localStorage.getItem(PLACE_KEY));
    if (p && typeof p.lat === "number") return p;
  } catch {}
  return gpsPlace() || CHENNAI;
}

function setPlace(p) {
  try {
    if (p) localStorage.setItem(PLACE_KEY, JSON.stringify(p));
    else localStorage.removeItem(PLACE_KEY);
  } catch {}
  fillPicker();
  refresh();
}

// Picker: automatic (your location or Chennai), the districts, and a searched place.
function fillPicker() {
  const p = place();
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(PLACE_KEY));
  } catch {}
  const opts = [new Option(gpsPlace() ? "Your location" : "Chennai", "auto")];
  const isDistrict = saved && AREAS.some((a) => a[1] === saved.name);
  if (saved && !isDistrict) opts.push(new Option(saved.name, "saved"));
  opts.push(...AREAS.map((a, i) => new Option(`${a[1]} district`, String(i))));
  placePick.replaceChildren(...opts);
  placePick.value = !saved ? "auto" : isDistrict ? String(AREAS.findIndex((a) => a[1] === saved.name)) : "saved";
  return p;
}

async function getJson(u) {
  const res = await fetch(u);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// A place name (Open-Meteo's place list) or a 6-digit pincode (OpenStreetMap's Nominatim).
async function search(q) {
  if (/^\d{6}$/.test(q)) {
    const list = await getJson(
      `https://nominatim.openstreetmap.org/search?${new URLSearchParams({ postalcode: q, countrycodes: "in", format: "json", addressdetails: "1", limit: "3" })}`
    );
    return list.map((r) => {
      const a = r.address || {};
      const where = a.suburb || a.city_district || a.village || a.town || a.city || a.county || "";
      return { lat: Number(r.lat), lon: Number(r.lon), name: `${q}${where ? ` ${where}` : ""}`, detail: r.display_name };
    });
  }
  const data = await getJson(`https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: q, count: "6", countryCode: "IN", language: "en" })}`);
  return (data.results || []).map((r) => ({
    lat: r.latitude,
    lon: r.longitude,
    name: r.name,
    detail: [r.admin3, r.admin2, r.admin1].filter(Boolean).join(", "),
  }));
}

async function runSearch() {
  const q = $("heat-q").value.trim();
  const list = $("heat-results");
  if (!q) return;
  list.replaceChildren(Object.assign(document.createElement("li"), { textContent: "Searching…" }));
  try {
    const found = await search(q);
    if (!found.length) {
      list.replaceChildren(Object.assign(document.createElement("li"), { textContent: "No place found. Try a nearby town or another spelling." }));
      return;
    }
    list.replaceChildren(
      ...found.map((f) => {
        const li = document.createElement("li");
        const b = document.createElement("button");
        b.type = "button";
        b.className = "rank-row";
        b.innerHTML = "<span class=\"rank-name\"></span>";
        b.querySelector("span").textContent = f.detail ? `${f.name} · ${f.detail}` : f.name;
        b.addEventListener("click", () => {
          list.replaceChildren();
          $("heat-q").value = "";
          setPlace({ lat: f.lat, lon: f.lon, name: f.name });
        });
        li.append(b);
        return li;
      })
    );
  } catch (e) {
    list.replaceChildren(
      Object.assign(document.createElement("li"), {
        textContent: /Failed to fetch|NetworkError|Load failed/.test(e.message) ? "Couldn't search just now. Check the connection." : `Couldn't search (${e.message}).`,
      })
    );
  }
}

const url = (p) =>
  "https://api.open-meteo.com/v1/forecast?" +
  new URLSearchParams({
    latitude: p.lat.toFixed(3),
    longitude: p.lon.toFixed(3),
    timezone: "Asia/Kolkata",
    forecast_days: 3,
    current: "temperature_2m,relative_humidity_2m",
    hourly: "temperature_2m,relative_humidity_2m,uv_index",
    daily: "uv_index_max",
  });

const r0 = (v) => (typeof v === "number" ? String(Math.round(v)) : "–");
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const localNow = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 13) + ":00";
const hourLabel = (iso) => {
  const h = Number(iso.slice(11, 13));
  return h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`;
};

function say(text, error = false) {
  status.textContent = text;
  status.className = error ? "status error" : "status";
}

function levelBadge(hi) {
  const l = levelOf(hi);
  const s = document.createElement("span");
  s.className = `heat-level heat-${l ? l.cls : "none"}`;
  s.textContent = l ? l.name : "–";
  return s;
}

function renderNow(data, where) {
  const c = data.current || {};
  const hi = heatIndex(c.temperature_2m, c.relative_humidity_2m);
  const wb = wetBulb(c.temperature_2m, c.relative_humidity_2m);
  const l = levelOf(hi);
  const box = $("heat-now");
  box.className = `heat-now heat-${l ? l.cls : "none"}`;
  box.innerHTML = `
    <div class="heat-big"><b></b><small>feels like</small></div>
    <div class="heat-facts">
      <span><small>Air</small><b></b></span>
      <span><small>Humidity</small><b></b></span>
      <span><small>Wet bulb</small><b></b></span>
    </div>
    <p class="heat-advice"></p>`;
  box.querySelector(".heat-big b").textContent = `${r0(hi)}°`;
  const [air, hum, wet] = box.querySelectorAll(".heat-facts b");
  air.textContent = `${r0(c.temperature_2m)}°`;
  hum.textContent = `${r0(c.relative_humidity_2m)}%`;
  wet.textContent = `${typeof wb === "number" ? wb.toFixed(1) : "–"}°`;
  const advice = box.querySelector(".heat-advice");
  advice.append(levelBadge(hi), ` ${l ? l.advice : ""}`);
  if (wb >= 31) advice.append(" Wet bulb above 31°: sweating barely cools the body.");
  $("heat-place").textContent = `${where.name} · forecast model for the hour, not a measurement`;
}

// The home station's latest reading, if the app has a recent one.
function renderStation() {
  const box = $("heat-station");
  let kept = null;
  try {
    kept = JSON.parse(localStorage.getItem("myweather.home.reading"));
  } catch {}
  const obs = kept?.obs;
  const m = obs?.metric;
  if (!m || typeof m.temp !== "number" || typeof obs.humidity !== "number" || Date.now() - obs.epoch * 1000 > 90 * 60 * 1000) {
    box.hidden = true;
    return;
  }
  const p = place();
  if (typeof obs.lat === "number" && km([obs.lat, obs.lon], [p.lat, p.lon]) > 25) {
    box.hidden = true;
    return;
  }
  const hi = heatIndex(m.temp, obs.humidity);
  box.hidden = false;
  box.replaceChildren(
    Object.assign(document.createElement("b"), { textContent: `Measured at ${obs.neighborhood || obs.stationID}: ` }),
    `${r0(m.temp)}° and ${r0(obs.humidity)}% humidity, feels like ${r0(hi)}° `,
    levelBadge(hi),
    Object.assign(document.createElement("small"), { textContent: ` · ${when(obs.epoch * 1000)}` })
  );
}

function renderHours(h) {
  const now = localNow();
  let start = h.time.findIndex((t) => t >= now);
  if (start < 0) start = 0;
  const end = Math.min(h.time.length, start + 48);
  const idx = Array.from({ length: end - start }, (_, i) => start + i);
  const temp = idx.map((i) => h.temperature_2m[i]);
  const hi = idx.map((i) => heatIndex(h.temperature_2m[i], h.relative_humidity_2m[i]));
  const wb = idx.map((i) => wetBulb(h.temperature_2m[i], h.relative_humidity_2m[i]));
  // Each day's hottest feel.
  const marks = [];
  let dayStart = 0;
  for (let k = 1; k <= idx.length; k++) {
    if (k === idx.length || h.time[idx[k]].slice(0, 10) !== h.time[idx[dayStart]].slice(0, 10)) {
      let top = dayStart;
      for (let j = dayStart; j < k; j++) if ((hi[j] ?? -99) > (hi[top] ?? -99)) top = j;
      if (typeof hi[top] === "number" && k - dayStart >= 4) marks.push({ at: top, value: hi[top], label: `${r0(hi[top])}°` });
      dayStart = k;
    }
  }
  const all = [...temp, ...hi].filter((v) => typeof v === "number");
  // Whole degrees on the 4 grid lines.
  const min = Math.floor(Math.min(...all)) - 1;
  const max = min + 4 * Math.ceil((Math.max(...all) + 2 - min) / 4);
  drawLines(
    $("heat-chart"),
    $("heat-readout"),
    {
      count: idx.length,
      series: [
        { values: temp, cls: "air" },
        { values: hi, cls: "feels" },
      ],
      ticks: idx.map((i, k) => (k % 6 === 0 ? { at: k, label: k === 0 ? "now" : hourLabel(h.time[i]) } : null)).filter(Boolean),
      points: idx.map((i, k) => {
        const l = levelOf(hi[k]);
        const day = DAYS[new Date(`${h.time[i]}:00`).getDay()];
        return {
          at: k,
          text:
            `${k === 0 ? "Now" : `${day} ${hourLabel(h.time[i])}`} · air ${r0(temp[k])}°, humidity ${r0(h.relative_humidity_2m[i])}%, ` +
            `feels ${r0(hi[k])}° (${l ? l.name : "–"}) · wet bulb ${typeof wb[k] === "number" ? wb[k].toFixed(1) : "–"}°` +
            (typeof h.uv_index?.[i] === "number" && h.uv_index[i] >= 1 ? ` · UV ${Math.round(h.uv_index[i])}` : ""),
        };
      }),
      marks,
    },
    "Tap the chart for any hour.",
    { unit: "°C", min, max, now: 0 }
  );
  // A strip of the heat-stress level hour by hour.
  const strip = $("heat-strip");
  strip.replaceChildren(
    ...hi.map((v, k) => {
      const l = levelOf(v);
      const i = document.createElement("i");
      i.style.background = l ? l.color : "var(--grid)";
      i.title = `${hourLabel(h.time[idx[k]])}: ${l ? l.name : "–"}`;
      return i;
    })
  );
  $("heat-legend").replaceChildren(
    ...LEVELS.map((l) => {
      const s = document.createElement("span");
      s.style.setProperty("--level", l.color);
      s.textContent = l.name;
      return s;
    })
  );
}

function renderDays(data) {
  const h = data.hourly;
  const byDay = new Map();
  h.time.forEach((t, i) => {
    const day = t.slice(0, 10);
    const hi = heatIndex(h.temperature_2m[i], h.relative_humidity_2m[i]);
    const d = byDay.get(day) || { hi: -99, at: "", t: -99, hours: 0, wb: -99 };
    if (typeof hi === "number" && hi > d.hi) Object.assign(d, { hi, at: t, rh: h.relative_humidity_2m[i] });
    if (h.temperature_2m[i] > d.t) d.t = h.temperature_2m[i];
    const wb = wetBulb(h.temperature_2m[i], h.relative_humidity_2m[i]);
    if (wb > d.wb) d.wb = wb;
    if (hi >= 32) d.hours++;
    byDay.set(day, d);
  });
  const uv = data.daily?.uv_index_max || [];
  $("heat-days").replaceChildren(
    ...[...byDay].map(([day, d], k) => {
      const li = document.createElement("li");
      const date = new Date(`${day}T00:00`);
      li.innerHTML = `<span class="fc-day"><b></b><small></small></span><span class="heat-day-text"><span></span><small></small></span><span class="fc-temp"><b></b> <small></small></span>`;
      li.querySelector(".fc-day b").textContent = k === 0 ? "Today" : DAYS[date.getDay()];
      li.querySelector(".fc-day small").textContent = `${date.getDate()}/${date.getMonth() + 1}`;
      li.querySelector(".heat-day-text span").append(levelBadge(d.hi));
      li.querySelector(".heat-day-text small").textContent =
        `${d.hours ? `${d.hours} h at 32°+ feel` : "No hours at 32°+ feel"} · peak ${hourLabel(d.at)} · wet bulb up to ${d.wb.toFixed(1)}°` +
        (typeof uv[k] === "number" ? ` · UV ${Math.round(uv[k])}` : "");
      li.querySelector(".fc-temp b").textContent = `${r0(d.hi)}°`;
      li.querySelector(".fc-temp small").textContent = `air ${r0(d.t)}°`;
      return li;
    })
  );
}

function render(data, where) {
  renderNow(data, where);
  renderStation();
  renderHours(data.hourly);
  renderDays(data);
}

async function refresh() {
  const where = place();
  say("Loading…");
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch(url(where), { signal: ctrl.signal }).finally(() => clearTimeout(timer));
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.reason || `HTTP ${res.status}`);
    render(data, where);
    loadedAt = Date.now();
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify({ at: loadedAt, data, where }));
    } catch {}
    say(`Updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
  } catch (e) {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(SAVED_KEY));
    } catch {}
    if (saved?.data) {
      render(saved.data, saved.where || CHENNAI);
      say(`Couldn't load a new forecast. Showing the one from ${when(saved.at)}.`, true);
    } else say(`Couldn't load the forecast (${e.message}). Try Refresh.`, true);
  }
}

export function initHeat() {
  $("heat-refresh").addEventListener("click", refresh);
  fillPicker();
  placePick.addEventListener("change", () => {
    const v = placePick.value;
    if (v === "auto") setPlace(null);
    else if (v !== "saved") {
      const a = AREAS[Number(v)];
      setPlace({ lat: a[2], lon: a[3], name: a[1] });
    }
  });
  $("heat-go").addEventListener("click", runSearch);
  $("heat-q").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      runSearch();
    }
  });
}

export function showHeat() {
  fillPicker();
  if (Date.now() - loadedAt > TTL) refresh();
  else renderStation();
}
