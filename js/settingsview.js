// Settings (#settings): home district, units, default radar, data saver,
// theme, which screens the menu shows, and a backup of everything picked on
// the phone (favourites, stations, places, settings) as one small JSON file.
import { TN_DISTRICTS } from "./districts.js";
import { homeDistrict, setHomeDistrict, units, setUnits, hiddenViews, setHiddenViews } from "./prefs.js";
import { STATIONS, PRODUCTS } from "./stations.js";
import { RADARS } from "./radarmap.js";
import { bindSaver } from "./datasaver.js";
import { currentTheme, setTheme } from "./theme.js";
import { shareImage } from "./share.js";
import { routeParams } from "./route.js";

const $ = (id) => document.getElementById(id);
const status = $("set-status");

// Screens that always stay in the menu.
const LOCKED = new Set(["home", "settings", "info"]);
// Per-screen district picks that follow the home district once cleared.
const AREA_KEYS = ["myweather.digest.area", "myweather.records.area", "myweather.spell.area", "myweather.yoy.area", "myweather.heat.place"];

function say(text, error = false) {
  status.textContent = text;
  status.className = error ? "status error" : "status";
}

const getJson = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
const setRaw = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {}
};

// ---- Home district and units ----

function initDistrict() {
  const pick = $("set-district");
  pick.replaceChildren(...TN_DISTRICTS.map(([n]) => new Option(n, n)));
  pick.value = homeDistrict();
  pick.addEventListener("change", () => {
    setHomeDistrict(pick.value);
    for (const k of AREA_KEYS) {
      try {
        localStorage.removeItem(k);
      } catch {}
    }
    say(`Home district: ${pick.value}. Screens already opened switch to it the next time the app starts.`);
  });
}

function initUnits() {
  const u = units();
  const temp = $("set-temp");
  const wind = $("set-wind");
  temp.value = u.temp;
  wind.value = u.wind;
  const saved = () => say("Units saved. Screens show them the next time they load or refresh.");
  temp.addEventListener("change", () => (setUnits({ temp: temp.value }), saved()));
  wind.addEventListener("change", () => (setUnits({ wind: wind.value }), saved()));
}

// ---- Default radar ----

function initRadar() {
  const city = $("set-radar-city");
  const product = $("set-radar-product");
  const map = $("set-radarmap");
  city.replaceChildren(...STATIONS.map((s) => new Option(s.name, s.code)));
  product.replaceChildren(...PRODUCTS.map((p) => new Option(p.name, p.code)));
  map.replaceChildren(...RADARS.map((r) => new Option(r.name, r.code)));
  const def = getJson("myweather.radar.default", {});
  city.value = STATIONS.some((s) => s.code === def.city) ? def.city : "cni";
  product.value = PRODUCTS.some((p) => p.code === def.product) ? def.product : "caz";
  let st = "";
  try {
    st = localStorage.getItem("myweather.radarmap.station") || "";
  } catch {}
  map.value = RADARS.some((r) => r.code === st) ? st : RADARS[0].code;
  const saveRadar = () => {
    setRaw("myweather.radar.default", JSON.stringify({ city: city.value, product: product.value }));
    say("Default radar saved. The Radars screen opens on it next time the app starts.");
  };
  city.addEventListener("change", () => {
    saveRadar();
    // The radar map follows when it has the same radar.
    if (RADARS.some((r) => r.code === city.value)) {
      map.value = city.value;
      setRaw("myweather.radarmap.station", city.value);
    }
  });
  product.addEventListener("change", saveRadar);
  map.addEventListener("change", () => {
    setRaw("myweather.radarmap.station", map.value);
    say("The radar map opens on " + map.selectedOptions[0].text + " next time the app starts.");
  });
}

// ---- Data saver and theme ----

function initLook() {
  bindSaver($("set-saver"));
  const theme = $("set-theme");
  theme.value = currentTheme();
  theme.addEventListener("change", () => setTheme(theme.value));
  // The theme button in the menu changes it too.
  window.addEventListener("myweather:theme", () => (theme.value = currentTheme()));
}

// ---- Menu ----

function renderMenuPicks() {
  const hidden = hiddenViews();
  const box = $("set-menu");
  box.replaceChildren();
  for (const group of document.querySelectorAll("#menu-panel .menu-group")) {
    const h = document.createElement("h4");
    h.textContent = group.querySelector(".menu-head").textContent;
    const list = document.createElement("div");
    list.className = "set-menu-list";
    for (const a of group.querySelectorAll("a[data-view]")) {
      const view = a.dataset.view;
      const label = document.createElement("label");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = !hidden.has(view);
      box.disabled = LOCKED.has(view);
      box.dataset.view = view;
      if (box.disabled) label.className = "locked";
      label.append(box, a.textContent);
      list.append(label);
    }
    box.append(h, list);
  }
}

function saveMenu(set) {
  setHiddenViews(set);
  window.dispatchEvent(new Event("myweather:menu"));
}

function initMenu() {
  renderMenuPicks();
  $("set-menu").addEventListener("change", (e) => {
    const view = e.target.dataset?.view;
    if (!view || LOCKED.has(view)) return;
    const hidden = hiddenViews();
    if (e.target.checked) hidden.delete(view);
    else hidden.add(view);
    saveMenu(hidden);
  });
  $("set-menu-all").addEventListener("click", () => {
    saveMenu(new Set());
    renderMenuPicks();
  });
}

// ---- Backup and restore ----

// Data the app downloaded (it comes back by itself), and secrets, stay out.
const SKIP = [
  /\.last$/,
  /^myweather\.home\.(reading|pos)$/,
  /^myweather\.rain\./,
  /^myweather\.yoy\.season\./,
  /^myweather\.monsoon\./,
  /^myweather\.gauges\.normals$/,
  /^myweather\.records\.hours$/,
  /^myweather\.lakes\.days$/,
  /^myweather\.pws\.apikey$/,
];
const keep = (k) => k.startsWith("myweather.") && !SKIP.some((re) => re.test(k));

export function backupData() {
  const items = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (keep(k)) items[k] = localStorage.getItem(k);
    }
  } catch {}
  return { app: "MyWeather", backup: 1, savedAt: new Date().toISOString(), items };
}

/** Restores a backup (text). Returns the number of items restored; throws if it isn't one. */
export function restoreData(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That isn't a MyWeather backup.");
  }
  if (!data || data.app !== "MyWeather" || typeof data.items !== "object" || !data.items) throw new Error("That isn't a MyWeather backup.");
  let n = 0;
  for (const [k, v] of Object.entries(data.items)) {
    if (!keep(k) || typeof v !== "string") continue;
    setRaw(k, v);
    n++;
  }
  return n;
}

const backupText = () => JSON.stringify(backupData(), null, 1);

function backupName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `MyWeather-backup-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.json`;
}

function restored(n) {
  say(`Restored ${n} item${n === 1 ? "" : "s"}. Reloading…`);
  setTimeout(() => {
    history.replaceState(null, "", "#settings");
    location.reload();
  }, 700);
}

function initBackup() {
  $("set-backup").addEventListener("click", async () => {
    const blob = new Blob([backupText()], { type: "application/json" });
    try {
      const how = await shareImage({ blob, name: backupName(), text: "MyWeather backup" });
      if (how === "downloaded") say("Backup saved to Downloads.");
      else if (how === "shared") say("Pick Drive, Files or a chat to keep the backup in.");
    } catch (e) {
      say(`Couldn't share the backup (${e.message || e}). Use Copy backup below instead.`, true);
    }
  });
  const file = $("set-restore-file");
  $("set-restore").addEventListener("click", () => file.click());
  file.addEventListener("change", async () => {
    const f = file.files?.[0];
    file.value = "";
    if (!f) return;
    try {
      restored(restoreData(await f.text()));
    } catch (e) {
      say(e.message, true);
    }
  });
  const text = $("set-text");
  $("set-copy").addEventListener("click", async () => {
    text.value = backupText();
    try {
      await navigator.clipboard.writeText(text.value);
      say("Backup copied. Paste it into a note or a chat to keep it.");
    } catch {
      text.select();
      say("Select the text above and copy it.");
    }
  });
  $("set-paste").addEventListener("click", () => {
    if (!text.value.trim()) return say("Paste a backup into the box first.", true);
    try {
      restored(restoreData(text.value));
    } catch (e) {
      say(e.message, true);
    }
  });
}

// ---- Screen ----

export function initSettings() {
  initDistrict();
  initUnits();
  initRadar();
  initLook();
  initMenu();
  initBackup();
}

export function showSettings() {
  renderMenuPicks();
  if (routeParams().has("menu")) $("set-menu-card").scrollIntoView();
}
