// Single-page menu: #home, #radar, #satellite, #warnings, #wunderground, #blog.
// Each view's init runs the first time it is shown, and show every time.
import { showRadar } from "./radar.js";
import { showSatellite } from "./satellite.js";
import { showWarnings } from "./warnings.js";
import { initWunderground, showWunderground } from "./wunderground.js";
import { showBlog } from "./blog.js";

const VIEWS = {
  home: { title: "MyWeather" },
  radar: { title: "MyWeather · Radars", show: showRadar },
  satellite: { title: "MyWeather · Satellite", show: showSatellite },
  warnings: { title: "MyWeather · Warnings", show: showWarnings },
  wunderground: { title: "MyWeather · Wunderground", init: initWunderground, show: showWunderground },
  blog: { title: "MyWeather · Kea Blog", show: showBlog },
};
const started = new Set();

function route() {
  const name = location.hash.slice(1).split("?")[0];
  const view = VIEWS[name] ? name : "home";
  for (const key of Object.keys(VIEWS)) {
    document.getElementById(`view-${key}`).hidden = key !== view;
  }
  for (const a of document.querySelectorAll(".menu a")) {
    if (a.dataset.view === view) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
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

window.addEventListener("hashchange", route);
route();
