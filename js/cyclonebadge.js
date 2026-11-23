// A small red dot on the menu's Cyclone watch item (and on the menu button) while
// a storm is active near India. Reads the same hourly files as Cyclone watch
// (cyclone/latest.json, cyclone/world.json on the data branch) but none of its
// code, so Home stays light. Same rules as the screen: IMD's newest bulletin is
// under 24 h old and doesn't say the system weakened or dissipated; a storm from
// another agency counts only if it is over the north Indian Ocean (0-30°N,
// 40-100°E) and its latest advisory is under 24 h old.
import { hiddenViews } from "./prefs.js";

const DATA = "https://raw.githubusercontent.com/gkgsiva/MyWeather/data/cyclone/";
const HOURS = 24 * 3600 * 1000;
const EVERY = 30 * 60 * 1000;
const ENDED = /weakened\s+into\s+(?:a\s+|an\s+)?(?:well[\s-]*marked\s+)?low\s+pressure|dissipated|ceased\s+to\s+be|has\s+merged|remnant\s+low/i;

async function get(name) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(`${DATA}${name}?t=${Math.floor(Date.now() / 300000)}`, { signal: ctrl.signal, cache: "no-cache" });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Which storms are active near India: [] or a list of names.
export function activeNearIndia(b, world, now = Date.now()) {
  const out = [];
  const issued = Date.parse(b?.issued || "");
  if (b && !ENDED.test(b.subject || "") && Number.isFinite(issued) && now - issued < HOURS) out.push(b.name || "IMD storm");
  for (const w of world?.storms || []) {
    const at = Date.parse(w.at);
    if (w.lat == null || w.lat < 0 || w.lat > 30 || w.lon < 40 || w.lon > 100) continue;
    if (!Number.isFinite(at) || now - at >= HOURS) continue;
    // JTWC's twin of IMD's storm is the same storm.
    if (b && out.length && b.lat != null && Math.hypot(b.lat - w.lat, b.lon - w.lon) < 5) continue;
    out.push(w.name || w.number || "Storm");
  }
  return out;
}

let last = 0;
let names = [];

function paint() {
  const link = document.querySelector('.menu a[data-view="cyclonewatch"]');
  const on = names.length > 0;
  if (link) {
    link.classList.toggle("has-badge", on);
    link.title = on ? `Active: ${names.join(", ")}` : "";
    link.querySelector(".menu-badge")?.remove();
    if (on) {
      const dot = document.createElement("span");
      dot.className = "menu-badge";
      dot.setAttribute("role", "img");
      dot.setAttribute("aria-label", `Active storm: ${names.join(", ")}`);
      link.append(dot);
    }
  }
  // The menu button too, unless Cyclone watch is hidden in Settings.
  document.getElementById("menu-btn")?.classList.toggle("has-badge", on && !hiddenViews().has("cyclonewatch"));
}

export async function checkCycloneBadge(force = false) {
  if (!force && Date.now() - last < EVERY) return;
  last = Date.now();
  const [b, world] = await Promise.all([get("latest.json"), get("world.json")]);
  if (!b && !world) {
    last = 0; // nothing came back: try again next time
    return;
  }
  names = activeNearIndia(b, world);
  paint();
}

export function initCycloneBadge() {
  checkCycloneBadge();
  document.getElementById("menu-btn")?.addEventListener("click", () => checkCycloneBadge());
  window.addEventListener("myweather:menu", paint);
}
