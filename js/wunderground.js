// Wunderground: a dashboard of current readings for all saved stations, and each
// station's Wunderground page in a frame under the menu (#wunderground?id=<ID>).
// Readings come from api.weather.com (Wunderground's data service), which needs
// an API key: built in by the APK workflow, or entered under "Manage stations".
import { DEFAULT_PWS, pwsUrl } from "./pws-stations.js";
import { WEATHER_API_KEY } from "./config.js";
import { routeParams, IN_APP } from "./route.js";

const LIST_KEY = "myweather.pws.list";
const API_KEY_KEY = "myweather.pws.apikey";
const ID_RE = /^[A-Z0-9]{3,20}$/;
const STALE_MS = 60 * 60 * 1000;

const $ = (id) => document.getElementById(id);
const select = $("pws");
const dashboard = $("pws-dashboard");
const tbody = $("pws-table").querySelector("tbody");
const dashStatus = $("pws-dash-status");
const status = $("pws-status");
const frame = $("pws-frame");
const frameNote = $("pws-frame-note");
const removePick = $("pws-remove-pick");
const nameInput = $("pws-name");
const idInput = $("pws-id");
const keyInput = $("pws-key");
const keyNote = $("pws-key-note");

let stations = [];
let readings = new Map(); // id -> observation | null (offline) | Error
let loadedAt = 0;

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(LIST_KEY));
    if (Array.isArray(saved)) return saved.filter((s) => s && s.name && ID_RE.test(s.id));
  } catch {}
  return DEFAULT_PWS.map((s) => ({ ...s }));
}

function save() {
  try {
    localStorage.setItem(LIST_KEY, JSON.stringify(stations));
  } catch {}
}

function savedKey() {
  try {
    return localStorage.getItem(API_KEY_KEY) || "";
  } catch {
    return "";
  }
}
const apiKey = () => savedKey() || WEATHER_API_KEY;

function say(text, error = false) {
  status.textContent = text;
  status.className = error ? "status error" : "status";
}

// ---- Station picker and lists ----

function renderLists() {
  const current = routeParams().get("id") || "";
  select.replaceChildren(
    new Option("All stations · current readings", ""),
    ...stations.map((s) => new Option(`${s.name} (${s.id})`, s.id))
  );
  select.value = stations.some((s) => s.id === current) ? current : "";

  removePick.replaceChildren(
    new Option(stations.length ? "Choose a station…" : "No stations", ""),
    ...stations.map((s, i) => new Option(`${s.name} (${s.id})`, String(i)))
  );
  removePick.disabled = $("pws-remove-btn").disabled = !stations.length;
}

// ---- Dashboard ----

const fmt = (v, digits = 1) => (typeof v === "number" ? v.toFixed(digits) : "–");
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const compass = (deg) => (typeof deg === "number" ? COMPASS[Math.round(deg / 45) % 8] : "");

async function fetchReading(id, key) {
  const qs = new URLSearchParams({
    stationId: id,
    format: "json",
    units: "m",
    numericPrecision: "decimal",
    apiKey: key,
  });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(`https://api.weather.com/v2/pws/observations/current?${qs}`, {
      signal: ctrl.signal,
    });
    if (res.status === 204 || res.status === 404) return null; // offline or unknown
    if (res.status === 401 || res.status === 403) throw Object.assign(new Error("key"), { key: true });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    return body.observations?.[0] || null;
  } finally {
    clearTimeout(timer);
  }
}

function renderTable() {
  tbody.replaceChildren(
    ...stations.map((s) => {
      const r = readings.get(s.id);
      const m = r && !(r instanceof Error) ? r.metric || {} : {};
      const tr = document.createElement("tr");
      tr.tabIndex = 0;
      tr.addEventListener("click", () => openStation(s.id));
      tr.addEventListener("keydown", (e) => {
        if (e.key === "Enter") openStation(s.id);
      });
      const cells = [];
      const name = document.createElement("th");
      name.scope = "row";
      name.textContent = s.name;
      cells.push(name);
      if (r && !(r instanceof Error)) {
        const wind = `${fmt(m.windSpeed, 0)}/${fmt(m.windGust, 0)} ${compass(r.winddir)}`.trim();
        const when = new Date(r.epoch * 1000);
        const vals = [
          fmt(m.temp),
          fmt(m.precipTotal),
          fmt(m.precipRate),
          wind,
          when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        ];
        for (const v of vals) {
          const td = document.createElement("td");
          td.textContent = v;
          cells.push(td);
        }
        if (Date.now() - when > STALE_MS) cells[cells.length - 1].className = "stale";
        if (m.precipRate > 0) cells[3].className = "raining";
      } else {
        const td = document.createElement("td");
        td.colSpan = 5;
        td.className = "muted";
        td.textContent =
          r === undefined ? "Loading…" : r === null ? "Offline, no recent data" : "Couldn't load";
        cells.push(td);
      }
      tr.append(...cells);
      return tr;
    })
  );
}

async function refreshDashboard() {
  const key = apiKey();
  if (!key) {
    readings = new Map();
    tbody.replaceChildren();
    dashStatus.textContent =
      "Add your Wunderground API key under “Manage stations” below to see current readings.";
    dashStatus.className = "status error";
    return;
  }
  dashStatus.textContent = "Loading readings…";
  dashStatus.className = "status";
  readings = new Map();
  renderTable();
  const ids = [...new Set(stations.map((s) => s.id))];
  let keyError = false;
  await Promise.all(
    ids.map(async (id) => {
      try {
        readings.set(id, await fetchReading(id, key));
      } catch (e) {
        if (e.key) keyError = true;
        readings.set(id, e);
      }
      renderTable();
    })
  );
  loadedAt = Date.now();
  if (keyError) {
    dashStatus.textContent = "Wunderground didn't accept the API key. Check it under “Manage stations”.";
    dashStatus.className = "status error";
  } else {
    dashStatus.textContent = `Updated ${new Date().toLocaleTimeString()}`;
    dashStatus.className = "status";
  }
}

// ---- Station page ----

function openStation(id) {
  location.hash = id ? `#wunderground?id=${encodeURIComponent(id)}` : "#wunderground";
}

function render() {
  const id = routeParams().get("id");
  const station = id && stations.find((s) => s.id === id);
  select.value = station ? station.id : "";
  if (station) {
    dashboard.hidden = true;
    frame.hidden = false;
    const url = pwsUrl(station.id);
    if (frame.dataset.src !== url) {
      frame.dataset.src = url;
      frame.src = url;
    }
    // Wunderground can't be framed in an ordinary browser, only in the app.
    frameNote.hidden = IN_APP;
    $("pws-open").href = url;
    return;
  }
  frame.hidden = true;
  frameNote.hidden = true;
  dashboard.hidden = false;
  // Reload readings when coming back after a few minutes; Refresh forces it.
  if (Date.now() - loadedAt > 5 * 60 * 1000) refreshDashboard();
}

function renderKeyNote() {
  keyInput.value = savedKey();
  keyInput.placeholder = WEATHER_API_KEY ? "Using the key built into the app" : "Paste your key";
  keyNote.textContent = WEATHER_API_KEY
    ? "This app has a key built in. Enter another only to replace it; leave empty to use the built-in one."
    : "Station owners get a free key at wunderground.com/member/api-keys. It is saved only on this phone.";
}

export function initWunderground() {
  stations = load();
  renderLists();
  renderKeyNote();

  select.addEventListener("change", () => openStation(select.value));
  $("pws-refresh").addEventListener("click", () => {
    const id = routeParams().get("id");
    if (id) {
      frame.dataset.src = "";
      render();
    } else {
      refreshDashboard();
    }
  });

  $("pws-add").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    const id = idInput.value.trim().toUpperCase();
    if (!name) return say("Enter a nickname.", true);
    if (!ID_RE.test(id))
      return say("Station IDs are 3 to 20 letters and digits, like ICHENN47.", true);
    if (stations.some((s) => s.id === id && s.name === name))
      return say(`${name} (${id}) is already in the list.`, true);
    stations.push({ name, id });
    save();
    renderLists();
    nameInput.value = idInput.value = "";
    say(`Added ${name} (${id}).`);
    refreshDashboard();
  });

  $("pws-remove-btn").addEventListener("click", () => {
    const s = stations[Number(removePick.value)];
    if (removePick.value === "" || !s) return say("Choose a station to remove.", true);
    stations.splice(Number(removePick.value), 1);
    save();
    renderLists();
    renderTable();
    say(`Removed ${s.name} (${s.id}).`);
  });

  $("pws-reset").addEventListener("click", () => {
    stations = DEFAULT_PWS.map((s) => ({ ...s }));
    save();
    renderLists();
    say("Restored the default list.");
    refreshDashboard();
  });

  $("pws-key-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const key = keyInput.value.trim();
    try {
      if (key) localStorage.setItem(API_KEY_KEY, key);
      else localStorage.removeItem(API_KEY_KEY);
    } catch {}
    renderKeyNote();
    say(key ? "API key saved on this phone." : "Saved key removed.");
    refreshDashboard();
  });
}

// Runs each time the Wunderground menu (or a station in it) is opened.
export function showWunderground() {
  render();
}
