// Home: the main station's reading now, the sun and moon for Chennai today,
// favourite screens pinned at the top, and every screen below.
//
// - Favourites: each card has a ☆ button; pinned cards are copied into the
//   Favourites list in the order they were pinned (localStorage).
// - Station strip: one Wunderground station (the first in the list unless
//   another is picked here), read again when Home opens after 5 minutes, or
//   with ↻ / pull to refresh. The last reading stays on screen offline.
// - Sun and moon: worked out on the phone (js/astro.js), no network.
import { loadStations, apiKey, fetchReading, loadLast } from "./wunderground.js";
import { when } from "./offline.js";
import { sunTimes, moonTimes, moonIllumination, phaseName, nextPhases } from "./astro.js";

const FAV_KEY = "myweather.home.favs";
const STATION_KEY = "myweather.home.station";
const READING_KEY = "myweather.home.reading";
const TTL = 5 * 60 * 1000;
const STALE_MS = 60 * 60 * 1000;
export const CHENNAI = { lat: 13.08, lon: 80.27 };

const $ = (id) => document.getElementById(id);
const allCards = $("all-cards");
const favCards = $("fav-cards");
const favHint = $("fav-hint");
const stationPick = $("home-station");
const stripBody = $("home-strip-body");
const stripStatus = $("home-strip-status");
const sky = $("home-sky");

let loadedAt = 0;
let skyDay = "";

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

// ---- Favourites ----

const cardOf = (href) => allCards.querySelector(`a.card[href="${href}"]`);
const loadFavs = () => read(FAV_KEY, []).filter((h) => typeof h === "string" && cardOf(h));

function starButton(href) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "fav-btn";
  b.dataset.href = href;
  return b;
}

function paintStars(favs) {
  for (const b of document.querySelectorAll(".fav-btn")) {
    const on = favs.includes(b.dataset.href);
    const name = cardOf(b.dataset.href).querySelector("strong").textContent;
    b.textContent = on ? "★" : "☆";
    b.setAttribute("aria-pressed", String(on));
    b.setAttribute("aria-label", on ? `Unpin ${name} from Favourites` : `Pin ${name} to Favourites`);
  }
}

function renderFavs() {
  const favs = loadFavs();
  favCards.replaceChildren(
    ...favs.map((href) => {
      const li = document.createElement("li");
      li.append(cardOf(href).cloneNode(true), starButton(href));
      return li;
    })
  );
  favCards.hidden = !favs.length;
  favHint.hidden = favs.length > 0;
  paintStars(favs);
}

function toggleFav(href) {
  const favs = loadFavs();
  const i = favs.indexOf(href);
  if (i >= 0) favs.splice(i, 1);
  else favs.push(href);
  write(FAV_KEY, favs);
  renderFavs();
}

function initFavs() {
  for (const li of allCards.children) {
    const href = li.querySelector("a.card").getAttribute("href");
    li.append(starButton(href));
  }
  for (const list of [allCards, favCards]) {
    list.addEventListener("click", (e) => {
      const b = e.target.closest(".fav-btn");
      if (b) toggleFav(b.dataset.href);
    });
  }
  renderFavs();
}

// ---- Station strip ----

const fmt = (v, digits = 1) => (typeof v === "number" ? v.toFixed(digits) : "–");
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const compass = (deg) => (typeof deg === "number" ? COMPASS[Math.round(deg / 45) % 8] : "");

function mainStation() {
  const stations = loadStations();
  const saved = read(STATION_KEY, "");
  return stations.find((s) => s.id === saved) || stations[0] || null;
}

function renderPicker() {
  const stations = loadStations();
  const main = mainStation();
  const seen = new Set();
  stationPick.replaceChildren(
    ...stations
      .filter((s) => !seen.has(s.id) && seen.add(s.id))
      .map((s) => new Option(s.name, s.id))
  );
  if (main) stationPick.value = main.id;
  stationPick.disabled = !stations.length;
}

function say(text, error = false) {
  stripStatus.textContent = text;
  stripStatus.className = error ? "strip-status error" : "strip-status";
}

function stat(value, label) {
  const s = document.createElement("span");
  s.className = "strip-stat";
  s.innerHTML = "<b></b><small></small>";
  s.querySelector("b").textContent = value;
  s.querySelector("small").textContent = label;
  return s;
}

function renderStrip(obs) {
  const main = mainStation();
  stripBody.href = main ? `#wunderground?id=${encodeURIComponent(main.id)}` : "#wunderground";
  if (!obs) {
    stripBody.replaceChildren(stat("–", "°C"), stat("–", "mm today"), stat("–", "mm/h now"), stat("–", "km/h"));
    stripBody.classList.remove("wet");
    return;
  }
  const m = obs.metric || {};
  stripBody.replaceChildren(
    stat(fmt(m.temp), "°C"),
    stat(fmt(m.precipTotal), "mm today"),
    stat(fmt(m.precipRate), "mm/h now"),
    stat(`${fmt(m.windSpeed, 0)} ${compass(obs.winddir)}`.trim(), "km/h wind"),
    stat(typeof obs.humidity === "number" ? `${Math.round(obs.humidity)}%` : "–", "humidity")
  );
  stripBody.classList.toggle("wet", m.precipRate > 0);
}

function readingLine(obs, savedAt) {
  const at = new Date(obs.epoch * 1000);
  const time = when(at.valueOf());
  const old = Date.now() - at > STALE_MS;
  return { text: `Reading at ${time}${old ? ", over an hour old" : ""}${savedAt ? ` · no connection, kept from ${when(savedAt)}` : ""}`, old };
}

// The Android rain & temperature widget reads the same station with the same key.
// Only the app's own page can send this (see MainActivity.listenToPage).
function tellWidget(station, key) {
  const bridge = window.MyWeatherAndroid;
  if (!bridge || typeof bridge.postMessage !== "function") return;
  try {
    bridge.postMessage(JSON.stringify({ action: "widgetStation", id: station.id, name: station.name, key }));
  } catch {}
}

async function refreshStrip() {
  const main = mainStation();
  renderPicker();
  if (!main) {
    renderStrip(null);
    return say("Add stations on the Wunderground screen.", true);
  }
  const kept = read(READING_KEY, null);
  const keptObs = kept?.id === main.id ? kept.obs : loadLast()?.readings?.[main.id] || null;
  renderStrip(keptObs);
  const key = apiKey();
  if (!key) return say("Add your Wunderground API key under Wunderground → Manage stations.", true);
  tellWidget(main, key);
  say("Loading…");
  try {
    const obs = await fetchReading(main.id, key);
    if (mainStation()?.id !== main.id) return; // picked another meanwhile
    loadedAt = Date.now();
    if (!obs) {
      renderStrip(null);
      return say(`${main.name} is offline: no recent data.`, true);
    }
    write(READING_KEY, { id: main.id, obs, at: Date.now() });
    renderStrip(obs);
    const line = readingLine(obs);
    say(line.text, line.old);
  } catch (e) {
    if (e.key) return say("Wunderground didn't accept the API key. Check it under Wunderground → Manage stations.", true);
    if (keptObs) {
      const line = readingLine(keptObs, kept?.at || loadLast()?.at);
      say(line.text, true);
    } else say("Couldn't reach Wunderground.", true);
  }
}

// ---- Sun and moon ----

const hm = (d) => (d ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "–");
const dayMonth = (d) => d.toLocaleDateString([], { day: "numeric", month: "short" });

function renderSky() {
  const now = new Date();
  skyDay = now.toDateString();
  const sun = sunTimes(now, CHENNAI.lat, CHENNAI.lon);
  const moon = moonTimes(now, CHENNAI.lat, CHENNAI.lon);
  const ill = moonIllumination(now);
  const { name, icon } = phaseName(ill.phase);
  const next = nextPhases(now);
  const len = sun.sunset - sun.sunrise;
  const hrs = Math.floor(len / 3600000);
  const mins = Math.round((len % 3600000) / 60000);
  const nextLine = [
    [next.full, "Full moon"],
    [next.new, "New moon"],
  ]
    .filter(([d]) => d)
    .sort((a, b) => a[0] - b[0])
    .map(([d, label]) => `${label} ${dayMonth(d)}`)
    .join(" · ");
  sky.innerHTML = `
    <div class="sky-row">
      <span class="sky-icon" aria-hidden="true">☀️</span>
      <span class="sky-times">
        <span><small>Sunrise</small><b>${hm(sun.sunrise)}</b></span>
        <span><small>Sunset</small><b>${hm(sun.sunset)}</b></span>
        <span><small>Daylight</small><b>${hrs}h ${mins}m</b></span>
      </span>
    </div>
    <div class="sky-row">
      <span class="sky-icon" aria-hidden="true">${icon}</span>
      <span class="sky-times">
        <span><small>Moonrise</small><b>${hm(moon.rise)}</b></span>
        <span><small>Moonset</small><b>${hm(moon.set)}</b></span>
        <span><small>${name}</small><b>${Math.round(ill.fraction * 100)}% lit</b></span>
      </span>
    </div>
    <small class="sky-note">Chennai · first light ${hm(sun.dawn)}, last light ${hm(sun.dusk)}${nextLine ? ` · ${nextLine}` : ""}</small>`;
}

// ---- Screen ----

export function initHome() {
  initFavs();
  renderPicker();
  stationPick.addEventListener("change", () => {
    write(STATION_KEY, stationPick.value);
    refreshStrip();
  });
  $("home-refresh").addEventListener("click", refreshStrip);
}

export function showHome() {
  renderFavs();
  if (skyDay !== new Date().toDateString()) renderSky();
  if (Date.now() - loadedAt > TTL) refreshStrip();
  else renderPicker();
}
