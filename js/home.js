// Home: the main station's reading now, the sun and moon for Chennai today,
// favourite screens pinned at the top, and every screen below.
//
// - Favourites: each card has a ☆ button; pinned cards are copied into the
//   Favourites list in the order they were pinned (localStorage).
// - Station strip: one Wunderground station (the first in the list unless
//   another is picked here), read again when Home opens after 5 minutes, or
//   with ↻ / pull to refresh. The last reading stays on screen offline.
// - Sun and moon: worked out on the phone (js/astro.js), no network.
// - Near you (off until turned on): the phone's position picks the nearest
//   saved station for the strip, the nearest TN rain gauge and the nearest
//   radar on the radar map; sun and moon are worked out for that place.
import { loadStations, apiKey, fetchReading, loadLast } from "./wunderground.js";
import { when } from "./offline.js";
import { sunTimes, moonTimes, moonIllumination, phaseName, nextPhases } from "./astro.js";
import { loadCoords, addTiles, loadLeaflet } from "./stationmap.js";
import { km } from "./floods.js";
import { RADARS, runNowcast, nowcastPlace, setNowcastPlace } from "./radarmap.js";
import { searchPlaces } from "./places.js";
import { loadNowcast, headline } from "./nowcast.js";
import { getDay, currentRainDay } from "./gaugedays.js";

const FAV_KEY = "myweather.home.favs";
const STATION_KEY = "myweather.home.station";
const READING_KEY = "myweather.home.reading";
const GPS_KEY = "myweather.home.gps"; // true when "Use my location" is on
const POS_KEY = "myweather.home.pos"; // { lat, lon, at }
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

// The saved station nearest the phone (when location is on and positions are known).
function nearestStation(stations) {
  const pos = gpsOn() && read(POS_KEY, null);
  if (!pos) return null;
  const coords = loadCoords();
  let best = null;
  for (const s of stations) {
    const c = coords[s.id];
    if (!c) continue;
    const d = km([pos.lat, pos.lon], c);
    if (!best || d < best.d) best = { s, d };
  }
  return best && best.d < 50 ? best : null;
}

function mainStation() {
  const stations = loadStations();
  const near = nearestStation(stations);
  if (near) return near.s;
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
    if (typeof obs.lat === "number") {
      const c = loadCoords();
      c[main.id] = [obs.lat, obs.lon];
      write("myweather.pws.coords", c);
    }
    renderStrip(obs);
    const line = readingLine(obs);
    const near = nearestStation(loadStations());
    say(near?.s.id === main.id ? `Nearest station, ${near.d.toFixed(1)} km away · ${line.text}` : line.text, line.old);
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

function skyPlace() {
  const pos = gpsOn() && read(POS_KEY, null);
  return pos ? { lat: pos.lat, lon: pos.lon, name: "Your location" } : { ...CHENNAI, name: "Chennai" };
}

function renderSky() {
  const now = new Date();
  const place = skyPlace();
  skyDay = `${now.toDateString()}|${place.lat.toFixed(2)},${place.lon.toFixed(2)}`;
  const sun = sunTimes(now, place.lat, place.lon);
  const moon = moonTimes(now, place.lat, place.lon);
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
    <small class="sky-note">${place.name} · first light ${hm(sun.dawn)}, last light ${hm(sun.dusk)}${nextLine ? ` · ${nextLine}` : ""}</small>`;
}

// ---- Near you ----

const nearBox = $("home-near");
const nearBody = $("home-near-body");
const nearBtn = $("home-gps");
const gpsOn = () => read(GPS_KEY, false) === true;
let nearAt = 0;

function paintGpsButton() {
  const on = gpsOn();
  nearBtn.textContent = on ? "Turn off" : "Use my location";
  nearBtn.setAttribute("aria-pressed", String(on));
  nearBox.classList.toggle("off", !on);
}

function locate() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("This phone can't share its location here."));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, at: Date.now() }),
      (e) =>
        reject(
          new Error(
            e.code === 1
              ? "Location permission is off. Allow it for MyWeather in the phone's settings."
              : "Couldn't find your location just now."
          )
        ),
      { enableHighAccuracy: false, timeout: 20000, maximumAge: 10 * 60 * 1000 }
    );
  });
}

function nearRow(icon, title, detail, href) {
  const a = document.createElement(href ? "a" : "div");
  a.className = "near-row";
  if (href) a.href = href;
  a.innerHTML = `<span class="near-icon" aria-hidden="true"></span><span class="near-text"><b></b><small></small></span>`;
  a.querySelector(".near-icon").textContent = icon;
  a.querySelector("b").textContent = title;
  a.querySelector("small").textContent = detail;
  return a;
}

const mm = (v) => (typeof v === "number" ? `${(Math.round(v * 10) / 10).toFixed(v % 1 ? 1 : 0)} mm` : "no data");

async function renderNear(fresh = false) {
  paintGpsButton();
  if (!gpsOn()) {
    nearBody.replaceChildren(
      nearRow("📍", "Off", "Turn on to follow the nearest station, rain gauge and radar wherever you are.")
    );
    return;
  }
  let pos = read(POS_KEY, null);
  if (fresh || !pos || Date.now() - pos.at > 10 * 60 * 1000) {
    nearBody.replaceChildren(nearRow("📍", "Finding your location…", ""));
    try {
      pos = await locate();
      write(POS_KEY, pos);
    } catch (e) {
      if (!pos) {
        nearBody.replaceChildren(nearRow("📍", "Location not available", e.message));
        return;
      }
    }
  }
  nearAt = Date.now();
  const here = [pos.lat, pos.lon];
  const rows = [];
  // Radar: the nearest of the radars on the radar map.
  const radar = RADARS.map((r) => ({ r, d: km(here, [r.lat, r.lon]) })).sort((a, b) => a.d - b.d)[0];
  rows.push(
    radar.d < 300
      ? nearRow("📡", `${radar.r.name} radar`, `${Math.round(radar.d)} km away · open it on the radar map`, `#radarmap?station=${radar.r.code}`)
      : nearRow("📡", "Radars", "No radar on the radar map covers you; see IMD's radars", "#radar")
  );
  const station = nearestStation(loadStations());
  rows.push(
    station
      ? nearRow("🌡️", station.s.name, `Nearest of your stations, ${station.d.toFixed(1)} km · shown in the strip above`, `#wunderground?id=${encodeURIComponent(station.s.id)}`)
      : nearRow("🌡️", "No saved station within 50 km", "Open the Station map once so the app learns where your stations are", "#map")
  );
  const gaugeRow = nearRow("🌧️", "Nearest TN rain gauge", "Loading…");
  rows.push(gaugeRow);
  const at = document.createElement("small");
  at.className = "strip-status";
  at.textContent = `Location from ${when(pos.at)} · ${pos.lat.toFixed(3)}, ${pos.lon.toFixed(3)}`;
  nearBody.replaceChildren(...rows, at);
  if (station && mainStation()?.id === station.s.id && stationPick.value !== station.s.id) refreshStrip();
  if (skyDay.split("|")[1] !== `${pos.lat.toFixed(2)},${pos.lon.toFixed(2)}`) renderSky();
  try {
    const day = await getDay(currentRainDay());
    let best = null;
    for (const g of day.gauges) {
      const d = km(here, [g[2], g[3]]);
      if (!best || d < best.d) best = { g, d };
    }
    if (!best || best.d > 30) {
      gaugeRow.replaceWith(nearRow("🌧️", "TN rain gauges", "No TN-SMART gauge within 30 km", "#gauges"));
      return;
    }
    const [district, name, , , total, wettest] = best.g;
    gaugeRow.replaceWith(
      nearRow(
        "🌧️",
        `${name} · ${mm(total)} today`,
        `Nearest TN rain gauge, ${best.d.toFixed(1)} km · ${district}` + (typeof wettest === "number" && wettest > 0 ? ` · wettest hour ${mm(wettest)}` : ""),
        `#gauges?gauge=${encodeURIComponent(`${district}|${name}`)}`
      )
    );
  } catch {
    gaugeRow.replaceWith(nearRow("🌧️", "TN rain gauges", "Couldn't load the gauges just now", "#gauges"));
  }
}

// ---- Rain coming (nowcast from the radar loop) ----

const NOWCAST_FRESH = 20 * 60 * 1000;
let nowcastBusy = false;

function renderNowcast(msg) {
  const body = $("home-nowcast-body");
  const line = $("home-nowcast-status");
  const place = nowcastPlace();
  let s = loadNowcast();
  // A check made for another spot doesn't answer for this one.
  if (s && (Math.abs(s.lat - place.lat) > 0.005 || Math.abs(s.lon - place.lon) > 0.005)) s = null;
  const fresh = s && Date.now() - s.at < NOWCAST_FRESH;
  body.replaceChildren();
  const icon = document.createElement("span");
  icon.className = "near-icon";
  icon.setAttribute("aria-hidden", "true");
  const text = document.createElement("span");
  text.className = "near-text";
  const b = document.createElement("b");
  const small = document.createElement("small");
  text.append(b, small);
  body.append(icon, text);
  if (s) {
    const r = s.result;
    icon.textContent = r.raining ? "🌧️" : r.eta !== null ? "☔" : "🌤️";
    b.textContent = headline(r);
    small.textContent =
      `${s.place} · ${s.radar} radar, ${s.frame ? `scan of ${new Date(s.frame).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : `checked ${when(s.at)}`}` +
      (fresh ? "" : " · old, check again");
    body.classList.toggle("stale", !fresh);
    body.classList.toggle("wet", r.raining || r.eta !== null);
  } else {
    icon.textContent = "📡";
    b.textContent = `Will rain reach ${place.name === "Your location" ? "you" : place.name} in the next 2 hours?`;
    small.textContent = "Tap Check radar: the app follows the rain on IMD's radar loop (1 to 5 MB).";
  }
  line.textContent = msg || "";
  line.className = "strip-status";
}

async function checkNowcast() {
  if (nowcastBusy) return;
  nowcastBusy = true;
  const btn = $("home-nowcast-btn");
  btn.disabled = true;
  renderNowcast("Reading the radar loop…");
  try {
    await runNowcast(nowcastPlace());
    renderNowcast("Worked out by the app from the radar's last hour; rain can grow, fade or turn.");
  } catch (e) {
    renderNowcast(
      /Failed to fetch|NetworkError|Load failed/.test(e.message)
        ? "Couldn't read IMD's radar (only works inside the app)."
        : `Couldn't check the radar (${e.message}).`
    );
    $("home-nowcast-status").className = "strip-status error";
  } finally {
    nowcastBusy = false;
    btn.disabled = false;
  }
}

// ---- Spot for "Rain coming?": search a place or pincode, or tap the map ----

let L = null; // Leaflet, loaded when the picker first opens
let ncMap = null;
let ncPin = null;
let ncPending = null; // { lat, lon, name } chosen in the panel, saved on "Check this spot"

function movePin(p) {
  ncPending = p;
  $("home-nc-ok").textContent = `Check ${p.name === "Picked spot" ? "this spot" : p.name}`;
  if (!ncMap) return;
  const ll = [p.lat, p.lon];
  if (ncPin) ncPin.setLatLng(ll);
  else
    ncPin = L.marker(ll, {
      icon: L.divIcon({ className: "", html: '<span class="nc-pin">📍</span>', iconSize: null }),
      interactive: false,
    }).addTo(ncMap);
}

async function openSpotPicker(open) {
  const panel = $("home-nc-pick");
  panel.hidden = !open;
  $("home-nc-spot").setAttribute("aria-expanded", String(open));
  if (!open) return;
  try {
    L = L || (await loadLeaflet());
  } catch {
    $("home-nc-map").textContent = "Couldn't load the map. Search a place instead.";
    return;
  }
  const place = nowcastPlace();
  $("home-nc-auto").textContent = gpsOn() ? "Use my location" : "Back to Chennai";
  $("home-nc-auto").hidden = !place.picked;
  if (!ncMap) {
    const box = $("home-nc-map");
    ncMap = L.map(box, { zoomControl: true }).setView([place.lat, place.lon], 11);
    addTiles(L, ncMap, box);
    ncMap.on("click", (e) => movePin({ lat: e.latlng.lat, lon: e.latlng.lng, name: "Picked spot" }));
  } else {
    ncMap.invalidateSize();
    ncMap.setView([place.lat, place.lon], Math.max(ncMap.getZoom(), 11));
  }
  movePin({ lat: place.lat, lon: place.lon, name: place.name });
  ncPending = null; // nothing new picked yet
}

async function runSpotSearch() {
  const q = $("home-nc-q").value.trim();
  const list = $("home-nc-results");
  if (!q) return;
  const li = (text) => Object.assign(document.createElement("li"), { textContent: text });
  list.replaceChildren(li("Searching…"));
  try {
    const found = await searchPlaces(q);
    if (!found.length) return list.replaceChildren(li("No place found. Try a nearby area or another spelling."));
    list.replaceChildren(
      ...found.map((f) => {
        const row = document.createElement("li");
        const b = document.createElement("button");
        b.type = "button";
        b.className = "rank-row";
        b.innerHTML = '<span class="rank-name"></span>';
        b.querySelector("span").textContent = f.detail ? `${f.name} · ${f.detail}` : f.name;
        b.addEventListener("click", () => {
          list.replaceChildren();
          $("home-nc-q").value = "";
          movePin({ lat: f.lat, lon: f.lon, name: f.name });
          ncMap?.setView([f.lat, f.lon], 13);
        });
        row.append(b);
        return row;
      })
    );
  } catch (e) {
    list.replaceChildren(
      li(/Failed to fetch|NetworkError|Load failed/.test(e.message) ? "Couldn't search just now. Check the connection." : `Couldn't search (${e.message}).`)
    );
  }
}

function useSpot(p) {
  setNowcastPlace(p);
  openSpotPicker(false);
  renderNowcast();
  checkNowcast();
}

function initSpotPicker() {
  $("home-nc-spot").addEventListener("click", () => openSpotPicker($("home-nc-pick").hidden));
  $("home-nc-go").addEventListener("click", runSpotSearch);
  $("home-nc-q").addEventListener("keydown", (e) => {
    if (e.key === "Enter") runSpotSearch();
  });
  $("home-nc-ok").addEventListener("click", () => (ncPending ? useSpot(ncPending) : (openSpotPicker(false), checkNowcast())));
  $("home-nc-auto").addEventListener("click", () => useSpot(null));
}

// ---- Screen ----

export function initHome() {
  initFavs();
  renderPicker();
  stationPick.addEventListener("change", () => {
    write(STATION_KEY, stationPick.value);
    // Picking a station by hand stops the strip following the nearest one.
    if (gpsOn() && nearestStation(loadStations())?.s.id !== stationPick.value) {
      write(GPS_KEY, false);
      renderNear();
      renderSky();
    }
    refreshStrip();
  });
  nearBtn.addEventListener("click", () => {
    write(GPS_KEY, !gpsOn());
    if (!gpsOn()) {
      renderSky();
      refreshStrip();
    }
    renderNear(true);
  });
  $("home-refresh").addEventListener("click", refreshStrip);
  $("home-nowcast-btn").addEventListener("click", checkNowcast);
  initSpotPicker();
}

export function showHome() {
  renderFavs();
  if (!nowcastBusy) renderNowcast();
  if (!skyDay.startsWith(new Date().toDateString())) renderSky();
  if (!nearAt || Date.now() - nearAt > TTL) renderNear();
  if (Date.now() - loadedAt > TTL) refreshStrip();
  else renderPicker();
}
