// Single-page menu: one <section id="view-NAME"> per screen, opened by #NAME.
// Each screen's code is loaded the first time it is opened (so the app starts
// with only Home's code), its init runs once, show every time it is opened,
// and hide when another screen is opened.
import { initTheme } from "./theme.js";
import { initPullToRefresh } from "./pull.js";
import { initSnaps } from "./snap.js";
import { hiddenViews } from "./prefs.js";

const VIEWS = {
  home: { title: "MyWeather", load: () => import("./home.js"), init: "initHome", show: "showHome" },
  digest: { title: "MyWeather · Morning digest", load: () => import("./digest.js"), init: "initDigest", show: "showDigest" },
  forecast: { title: "MyWeather · Forecast", load: () => import("./forecast.js"), init: "initForecast", show: "showForecast" },
  heat: { title: "MyWeather · Heat & humidity", load: () => import("./heat.js"), init: "initHeat", show: "showHeat" },
  nowcast: { title: "MyWeather · Rain nowcast", load: () => import("./nowcastview.js"), init: "initNowcastView", show: "showNowcastView" },
  rainmap: { title: "MyWeather · Rain map", load: () => import("./rainmap.js"), init: "initRainMap", show: "showRainMap" },
  radar: { title: "MyWeather · Radars", load: () => import("./radar.js"), show: "showRadar" },
  radarmap: { title: "MyWeather · Radar map", load: () => import("./radarmap.js"), init: "initRadarMap", show: "showRadarMap", hide: "hideRadarMap" },
  satellite: { title: "MyWeather · Satellite", load: () => import("./satellite.js"), show: "showSatellite" },
  lightning: { title: "MyWeather · Lightning", load: () => import("./lightning.js"), init: "initLightning", show: "showLightning" },
  warnings: { title: "MyWeather · Warnings", load: () => import("./warnings.js"), show: "showWarnings" },
  wind: { title: "MyWeather · Wind & storms", load: () => import("./wind.js"), init: "initWind", show: "showWind", hide: "hideWind" },
  cyclone: { title: "MyWeather · Cyclones", load: () => import("./cyclone.js"), init: "initCyclone", show: "showCyclone" },
  monsoon: { title: "MyWeather · Monsoon", load: () => import("./monsoon.js"), init: "initMonsoon", show: "showMonsoon" },
  yoy: { title: "MyWeather · Year on year", load: () => import("./yoy.js"), init: "initYoy", show: "showYoy" },
  rain: { title: "MyWeather · Rain history", load: () => import("./rain.js"), init: "initRain", show: "showRain", hide: "hideRain" },
  season: { title: "MyWeather · Rain season", load: () => import("./season.js"), init: "initSeason", show: "showSeason", hide: "hideSeason" },
  compare: { title: "MyWeather · Compare stations", load: () => import("./compare.js"), init: "initCompare", show: "showCompare", hide: "hideCompare" },
  map: { title: "MyWeather · Station map", load: () => import("./stationmap.js"), init: "initMap", show: "showMap" },
  gauges: { title: "MyWeather · TN rain gauges", load: () => import("./gauges.js"), init: "initGauges", show: "showGauges" },
  distrank: { title: "MyWeather · District rainfall", load: () => import("./distrank.js"), init: "initDistRank", show: "showDistRank" },
  health: { title: "MyWeather · Station health", load: () => import("./health.js"), init: "initHealth", show: "showHealth" },
  spell: { title: "MyWeather · Rain spell", load: () => import("./spell.js"), init: "initSpell", show: "showSpell" },
  records: { title: "MyWeather · Rain records", load: () => import("./records.js"), init: "initRecords", show: "showRecords" },
  floods: { title: "MyWeather · Flood spots", load: () => import("./floods.js"), init: "initFloods", show: "showFloods" },
  lakes: { title: "MyWeather · Lakes", load: () => import("./lakes.js"), init: "initLakes", show: "showLakes" },
  air: { title: "MyWeather · Air quality", load: () => import("./air.js"), init: "initAir", show: "showAir" },
  sea: { title: "MyWeather · Sea & tides", load: () => import("./sea.js"), init: "initSea", show: "showSea" },
  wunderground: { title: "MyWeather · Wunderground", load: () => import("./wunderground.js"), init: "initWunderground", show: "showWunderground" },
  blog: { title: "MyWeather · Kea Blog", load: () => import("./blog.js"), show: "showBlog" },
  settings: { title: "MyWeather · Settings", load: () => import("./settingsview.js"), init: "initSettings", show: "showSettings" },
  info: { title: "MyWeather · Info", load: () => import("./info.js"), init: "initInfo" },
};
const started = new Set();

// Hamburger menu: opens under the header bar; closes on a pick, a tap
// outside, or Escape.
const menuBtn = document.getElementById("menu-btn");
const menuPanel = document.getElementById("menu-panel");
const backdrop = document.getElementById("menu-backdrop");
const viewName = document.getElementById("view-name");

function setMenu(open) {
  menuPanel.hidden = backdrop.hidden = !open;
  menuBtn.setAttribute("aria-expanded", String(open));
  menuBtn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
}
menuBtn.addEventListener("click", () => setMenu(menuPanel.hidden));
backdrop.addEventListener("click", () => setMenu(false));
document.addEventListener("keydown", (e) => e.key === "Escape" && setMenu(false));
// Picking the screen already shown fires no hashchange, so close here too.
menuPanel.addEventListener("click", (e) => e.target.closest("a") && setMenu(false));
let shown = "";
const loaded = new Map(); // view → Promise of its module

// Screens hidden on the Settings screen leave the menu (links to them from
// other screens still work). A section with nothing left in it goes too.
export function applyHiddenViews() {
  const hidden = hiddenViews();
  for (const a of menuPanel.querySelectorAll("a[data-view]")) a.hidden = hidden.has(a.dataset.view);
  for (const g of menuPanel.querySelectorAll(".menu-group")) g.hidden = !g.querySelector("a[data-view]:not([hidden])");
}
window.addEventListener("myweather:menu", applyHiddenViews);

function moduleOf(view) {
  const v = VIEWS[view];
  if (!v.load) return Promise.resolve({});
  if (!loaded.has(view)) loaded.set(view, v.load());
  return loaded.get(view);
}

async function route() {
  const name = location.hash.slice(1).split("?")[0];
  const view = VIEWS[name] ? name : "home";
  if (shown && shown !== view) {
    const prev = shown;
    moduleOf(prev).then((m) => VIEWS[prev].hide && m[VIEWS[prev].hide]?.(), () => {});
  }
  shown = view;
  for (const key of Object.keys(VIEWS)) {
    document.getElementById(`view-${key}`).hidden = key !== view;
  }
  for (const a of document.querySelectorAll(".menu a")) {
    if (a.dataset.view === view) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  // Section name on the right of the header bar (none on Home).
  viewName.textContent = view === "home" ? "" : menuPanel.querySelector(`[data-view="${view}"]`).textContent;
  setMenu(false);
  document.title = VIEWS[view].title;
  window.scrollTo(0, 0);
  let m;
  try {
    m = await moduleOf(view);
  } catch (e) {
    loaded.delete(view);
    console.error(e);
    return;
  }
  if (shown !== view) return; // another screen was opened while this one loaded
  const v = VIEWS[view];
  if (!started.has(view)) {
    started.add(view);
    if (v.init) m[v.init]();
  }
  if (v.show) m[v.show]();
}

// Old links like ?city=cni&product=caz (no hash) open the radar.
if (!location.hash && new URLSearchParams(location.search).has("city")) {
  history.replaceState(null, "", `${location.search}#radar`);
}

// Pull to refresh reloads what the screen shows: a page in a frame is
// reloaded where it is, otherwise the screen's own Refresh button is pressed.
function refreshView({ href } = {}) {
  const section = document.getElementById(`view-${shown}`);
  const visible = (el) => el.offsetParent !== null;
  const frame = [...section.querySelectorAll("iframe")].find((f) => visible(f) && f.src);
  if (frame) {
    frame.src = /^https:\/\//.test(href || "") ? href : frame.src;
    return;
  }
  const button = [...section.querySelectorAll('button[id$="refresh"]')].find((b) => visible(b) && !b.disabled);
  button?.click();
}

initTheme();
// A Share button on every map, table, chart and list marked data-share.
initSnaps();
initPullToRefresh(refreshView, {
  // Not while the menu is open, and not on the map (dragging pans it).
  canStart: (target) => menuPanel.hidden && !target.closest?.(".leaflet-container"),
});
applyHiddenViews();
window.addEventListener("hashchange", route);
route();
// Once Home is up, load the other screens' code in the background while the
// phone is idle, so the first tap on each opens as fast as before.
const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
window.addEventListener("load", () =>
  setTimeout(() => idle(() => {
    const queue = Object.keys(VIEWS).filter((v) => v !== shown);
    const next = () => {
      const v = queue.shift();
      if (v) moduleOf(v).catch(() => loaded.delete(v)).finally(() => idle(next));
    };
    next();
  }), 3000)
);
