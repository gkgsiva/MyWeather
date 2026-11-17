// The map of the "Forecast vs what happened" panel: where the storm really
// was (red), the chosen forecast (dashed gold) and the error at each point
// (white line, km).
import { loadLeaflet } from "./stationmap.js";

const $ = (id) => document.getElementById(id);
const IST = { timeZone: "Asia/Kolkata" };
const fmt = (ms) => new Date(ms).toLocaleString("en-IN", { ...IST, day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
const round5 = (n) => Math.round(n / 5) * 5;
let L = null;
let map = null;
let group = null;

function key(color, text, dash) {
  const k = document.createElement("span");
  k.style.setProperty("--c", color);
  const i = document.createElement("i");
  i.className = `cw-key${dash ? " cw-dash" : ""}`;
  k.append(i, text);
  return k;
}

export async function drawTrackMap(storm, fc, pts) {
  try {
    if (!map) {
      L = await loadLeaflet();
      map = L.map($("cw-tr-map"), { zoomControl: true, attributionControl: true, minZoom: 3, maxZoom: 10 }).setView([14, 84], 5);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);
      group = L.layerGroup().addTo(map);
    }
  } catch (e) {
    $("cw-tr-legend").textContent = `The map didn't load (${e.message}).`;
    return;
  }
  group.clearLayers();
  const bounds = [];
  const path = storm.obs.map((o) => [o[1], o[2]]);
  if (path.length > 1) L.polyline(path, { color: "#ff5252", weight: 4 }).addTo(group);
  for (const o of storm.obs) L.circleMarker([o[1], o[2]], { radius: 3, color: "#ff5252", fillColor: "#ff5252", fillOpacity: 1, weight: 1 }).addTo(group);
  bounds.push(...path);
  // The forecast starts from the position it was made at.
  const bt = Date.parse(fc.base);
  const start = storm.obs.reduce((a, o) => (Math.abs(Date.parse(o[0]) - bt) < Math.abs(Date.parse(a[0]) - bt) ? o : a));
  const line = [[start[1], start[2]], ...pts.map((p) => [p.lat, p.lon])];
  L.polyline(line, { color: "#ffd54f", weight: 3, dashArray: "6 6" }).addTo(group);
  bounds.push(...line);
  for (const p of pts) {
    L.circleMarker([p.lat, p.lon], { radius: 5, color: "#ffd54f", fillColor: "#071a35", fillOpacity: 1, weight: 2 })
      .bindTooltip(`${fmt(p.t)}: forecast${p.err != null ? `, ${round5(p.err)} km off` : ""}`)
      .addTo(group);
    if (!p.obs) continue;
    L.polyline([[p.lat, p.lon], [p.obs[0], p.obs[1]]], { color: "#fff", weight: 1.5, opacity: 0.8 }).addTo(group);
    L.marker([(p.lat + p.obs[0]) / 2, (p.lon + p.obs[1]) / 2], {
      icon: L.divIcon({ className: "cw-label", html: `<span style="font-size:11px">${round5(p.err)} km</span>`, iconSize: [0, 0] }),
      interactive: false,
    }).addTo(group);
  }
  $("cw-tr-legend").replaceChildren(key("#ff5252", "Where it was"), " ", key("#ffd54f", "Forecast", true), " ", key("#fff", "Error"));
  map.invalidateSize();
  if (bounds.length) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 8 });
}

export function resizeTrackMap() {
  if (map) setTimeout(() => map.invalidateSize(), 0);
}
