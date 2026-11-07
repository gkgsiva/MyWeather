// Single-page menu: #home, #forecast, #radar, #radarmap, #satellite, #lightning, #warnings, #wind, #cyclone,
// #monsoon, #rain, #season, #compare, #map, #gauges, #floods, #lakes, #air, #sea, #wunderground, #blog. Each view's init runs the first time it is
// shown, show every time, and hide when another view is opened.
import { initHome, showHome } from "./home.js";
import { initForecast, showForecast } from "./forecast.js";
import { showRadar } from "./radar.js";
import { showSatellite } from "./satellite.js";
import { initLightning, showLightning } from "./lightning.js";
import { showWarnings } from "./warnings.js";
import { initWind, showWind, hideWind } from "./wind.js";
import { initCyclone, showCyclone } from "./cyclone.js";
import { initMonsoon, showMonsoon } from "./monsoon.js";
import { initRain, showRain, hideRain } from "./rain.js";
import { initSeason, showSeason, hideSeason } from "./season.js";
import { initCompare, showCompare, hideCompare } from "./compare.js";
import { initMap, showMap } from "./stationmap.js";
import { initGauges, showGauges } from "./gauges.js";
import { initRadarMap, showRadarMap, hideRadarMap } from "./radarmap.js";
import { initFloods, showFloods } from "./floods.js";
import { initLakes, showLakes } from "./lakes.js";
import { initAir, showAir } from "./air.js";
import { initSea, showSea } from "./sea.js";
import { initWunderground, showWunderground } from "./wunderground.js";
import { showBlog } from "./blog.js";
import { initTheme } from "./theme.js";
import { initPullToRefresh } from "./pull.js";

const VIEWS = {
  home: { title: "MyWeather", init: initHome, show: showHome },
  forecast: { title: "MyWeather · Forecast", init: initForecast, show: showForecast },
  radar: { title: "MyWeather · Radars", show: showRadar },
  radarmap: { title: "MyWeather · Radar map", init: initRadarMap, show: showRadarMap, hide: hideRadarMap },
  satellite: { title: "MyWeather · Satellite", show: showSatellite },
  lightning: { title: "MyWeather · Lightning", init: initLightning, show: showLightning },
  warnings: { title: "MyWeather · Warnings", show: showWarnings },
  wind: { title: "MyWeather · Wind & storms", init: initWind, show: showWind, hide: hideWind },
  cyclone: { title: "MyWeather · Cyclones", init: initCyclone, show: showCyclone },
  monsoon: { title: "MyWeather · Monsoon", init: initMonsoon, show: showMonsoon },
  rain: { title: "MyWeather · Rain history", init: initRain, show: showRain, hide: hideRain },
  season: { title: "MyWeather · Rain season", init: initSeason, show: showSeason, hide: hideSeason },
  compare: { title: "MyWeather · Compare stations", init: initCompare, show: showCompare, hide: hideCompare },
  map: { title: "MyWeather · Station map", init: initMap, show: showMap },
  gauges: { title: "MyWeather · TN rain gauges", init: initGauges, show: showGauges },
  floods: { title: "MyWeather · Flood spots", init: initFloods, show: showFloods },
  lakes: { title: "MyWeather · Lakes", init: initLakes, show: showLakes },
  air: { title: "MyWeather · Air quality", init: initAir, show: showAir },
  sea: { title: "MyWeather · Sea & tides", init: initSea, show: showSea },
  wunderground: { title: "MyWeather · Wunderground", init: initWunderground, show: showWunderground },
  blog: { title: "MyWeather · Kea Blog", show: showBlog },
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

function route() {
  const name = location.hash.slice(1).split("?")[0];
  const view = VIEWS[name] ? name : "home";
  if (shown && shown !== view) VIEWS[shown].hide?.();
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
  if (!started.has(view)) {
    started.add(view);
    VIEWS[view].init?.();
  }
  VIEWS[view].show?.();
  window.scrollTo(0, 0);
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
initPullToRefresh(refreshView, {
  // Not while the menu is open, and not on the map (dragging pans it).
  canStart: (target) => menuPanel.hidden && !target.closest?.(".leaflet-container"),
});
window.addEventListener("hashchange", route);
route();
