// Forecast (#forecast): Chennai's weather now, the chance of rain hour by hour
// for the next 24 hours, and 7 days ahead. From Open-Meteo (open-meteo.com,
// free, no key), which blends the global models (ECMWF, GFS and others) for
// the spot. The last forecast is kept on the phone for when the network drops.
import { drawBars } from "./chart.js";
import { when } from "./offline.js";
import { toTemp, toWind, windUnit } from "./prefs.js";

const CHENNAI = { lat: 13.0827, lon: 80.2707 };
const SAVED_KEY = "myweather.forecast.last";
const TTL = 15 * 60 * 1000;

export const FORECAST_URL =
  "https://api.open-meteo.com/v1/forecast?" +
  new URLSearchParams({
    latitude: CHENNAI.lat,
    longitude: CHENNAI.lon,
    timezone: "Asia/Kolkata",
    forecast_days: 7,
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,precipitation",
    hourly: "precipitation_probability,precipitation,temperature_2m,weather_code",
    daily:
      "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max",
  });

const $ = (id) => document.getElementById(id);
const status = $("fc-status");

let loadedAt = 0;

// WMO weather codes (as Open-Meteo sends them).
const CODES = {
  0: ["☀️", "Clear"],
  1: ["🌤️", "Mostly clear"],
  2: ["⛅", "Partly cloudy"],
  3: ["☁️", "Cloudy"],
  45: ["🌫️", "Fog"],
  48: ["🌫️", "Fog"],
  51: ["🌦️", "Light drizzle"],
  53: ["🌦️", "Drizzle"],
  55: ["🌧️", "Heavy drizzle"],
  56: ["🌧️", "Drizzle"],
  57: ["🌧️", "Drizzle"],
  61: ["🌦️", "Light rain"],
  63: ["🌧️", "Rain"],
  65: ["🌧️", "Heavy rain"],
  66: ["🌧️", "Rain"],
  67: ["🌧️", "Heavy rain"],
  71: ["🌨️", "Snow"],
  73: ["🌨️", "Snow"],
  75: ["🌨️", "Snow"],
  77: ["🌨️", "Snow"],
  80: ["🌦️", "Showers"],
  81: ["🌧️", "Showers"],
  82: ["⛈️", "Heavy showers"],
  85: ["🌨️", "Snow showers"],
  86: ["🌨️", "Snow showers"],
  95: ["⛈️", "Thunderstorm"],
  96: ["⛈️", "Thunderstorm, hail"],
  99: ["⛈️", "Thunderstorm, hail"],
};
export const code = (c) => CODES[c] || ["", "–"];
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const compass = (deg) => (typeof deg === "number" ? COMPASS[Math.round(deg / 45) % 8] : "");
const r0 = (v) => (typeof v === "number" ? String(Math.round(v)) : "–");
// Temperatures and wind in the units picked in Settings.
const t0 = (c) => r0(toTemp(c));
const w0 = (kmh) => r0(toWind(kmh));
const mm = (v) => (typeof v !== "number" ? "–" : v === 0 ? "0" : v < 10 ? v.toFixed(1) : String(Math.round(v)));
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function say(text, error = false) {
  status.textContent = text;
  status.className = error ? "status error" : "status";
}

// Times in the forecast are Chennai local ("2026-11-06T14:00"); the phone is on IST too.
const localNow = () => {
  const d = new Date(Date.now() + 5.5 * 3600 * 1000);
  return d.toISOString().slice(0, 13) + ":00";
};

function renderNow(c) {
  const [icon, text] = code(c.weather_code);
  $("fc-now").innerHTML = "";
  const big = document.createElement("div");
  big.className = "now-big";
  big.textContent = `${icon} ${t0(c.temperature_2m)}°`;
  const desc = document.createElement("div");
  desc.className = "now-desc";
  desc.innerHTML = `<strong></strong><span></span>`;
  desc.firstChild.textContent = text;
  desc.lastChild.textContent =
    `Feels ${t0(c.apparent_temperature)}° · Humidity ${r0(c.relative_humidity_2m)}% · ` +
    `Wind ${w0(c.wind_speed_10m)} ${windUnit()} ${compass(c.wind_direction_10m)}` +
    (c.precipitation > 0 ? ` · Rain ${mm(c.precipitation)} mm this hour` : "");
  $("fc-now").append(big, desc);
}

function renderHourly(h) {
  const now = localNow();
  let start = h.time.findIndex((t) => t >= now);
  if (start < 0) start = 0;
  const bars = [];
  for (let i = start; i < Math.min(h.time.length, start + 24); i++) {
    const hour = Number(h.time[i].slice(11, 13));
    const p = h.precipitation_probability[i];
    const label = i === start ? "Now" : `${String(hour).padStart(2, "0")}:00`;
    bars.push({
      value: typeof p === "number" ? p : null,
      tick: i === start ? "now" : hour % 3 === 0 ? String(hour) : "",
      cls: p >= 70 ? "wet" : "",
      text:
        `${label}${h.time[i].slice(0, 10) !== h.time[start].slice(0, 10) ? " tomorrow" : ""} · ${r0(p)}% chance of rain, ` +
        `${mm(h.precipitation[i])} mm · ${t0(h.temperature_2m[i])}° · ${code(h.weather_code[i])[1]}`,
    });
  }
  const wettest = bars.reduce((a, b) => ((b.value ?? -1) > (a?.value ?? -1) ? b : a), null);
  drawBars(
    $("fc-hourly"),
    $("fc-hourly-readout"),
    bars,
    wettest && wettest.value > 0 ? `Wettest hour: ${wettest.text}. Tap a bar for any hour.` : "No rain expected in the next 24 hours.",
    { unit: "%", max: 100, peak: (v) => `${Math.round(v)}%` }
  );
}

function renderDaily(d) {
  const list = $("fc-days");
  list.replaceChildren(
    ...d.time.map((t, i) => {
      const date = new Date(`${t}T00:00`);
      const [icon, text] = code(d.weather_code[i]);
      const li = document.createElement("li");
      const p = d.precipitation_probability_max[i];
      li.innerHTML = `
        <span class="fc-day"><b></b><small></small></span>
        <span class="fc-icon" aria-hidden="true"></span>
        <span class="fc-text"><span></span><small></small></span>
        <span class="fc-temp"><b></b> <small></small></span>
        <span class="fc-rain"><b></b><small></small></span>`;
      const q = (s) => li.querySelector(s);
      q(".fc-day b").textContent = i === 0 ? "Today" : DAYS[date.getDay()];
      q(".fc-day small").textContent = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
      q(".fc-icon").textContent = icon;
      q(".fc-text span").textContent = text;
      q(".fc-text small").textContent = `Wind ${w0(d.wind_speed_10m_max[i])}, gusts ${w0(d.wind_gusts_10m_max[i])} ${windUnit()}`;
      q(".fc-temp b").textContent = `${t0(d.temperature_2m_max[i])}°`;
      q(".fc-temp small").textContent = `${t0(d.temperature_2m_min[i])}°`;
      q(".fc-rain b").textContent = `${r0(p)}%`;
      q(".fc-rain small").textContent = `${mm(d.precipitation_sum[i])} mm`;
      if (p >= 70) li.classList.add("wet");
      return li;
    })
  );
}

function render(data) {
  if (data.current) renderNow(data.current);
  renderHourly(data.hourly);
  renderDaily(data.daily);
}

function loadSaved() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVED_KEY));
    return s && s.at && s.data ? s : null;
  } catch {
    return null;
  }
}

async function refresh() {
  say("Loading the forecast…");
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch(FORECAST_URL, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.reason || `HTTP ${res.status}`);
    render(data);
    loadedAt = Date.now();
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify({ at: loadedAt, data }));
    } catch {}
    say(`Updated ${new Date().toLocaleTimeString()}`);
  } catch (e) {
    const saved = loadSaved();
    if (saved) {
      render(saved.data);
      say(`Couldn't load a new forecast. Showing the one saved at ${when(saved.at)}.`, true);
    } else {
      say(`Couldn't load the forecast (${e.message}). Try Refresh.`, true);
    }
  }
}

export function initForecast() {
  $("fc-refresh").addEventListener("click", refresh);
}

export function showForecast() {
  if (Date.now() - loadedAt > TTL) refresh();
}
