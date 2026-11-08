// Cyclone track for the Radar map: IMD's current cyclone track from its map
// server (layer Cyclone_Track_V, the one behind IMD's own map). It is only
// filled while a depression or cyclone is active. IMD doesn't publish the
// cone of uncertainty as data, only on its track picture, so the app draws the
// track and links to that picture on the Cyclones screen. The server has no
// CORS header; the Android app adds it.
const WFS =
  "https://reactjs.imd.gov.in/geoserver/imd/wfs?service=WFS&version=1.0.0&request=GetFeature" +
  "&typeName=imd:Cyclone_Track_V&outputFormat=application/json&srsName=EPSG:4326";
const TTL = 15 * 60 * 1000;

// IMD's stages: D, DD, CS, SCS, VSCS, ESCS, SuCS.
const STAGES = {
  D: ["Depression", "#4caf50"],
  DD: ["Deep depression", "#8bc34a"],
  CS: ["Cyclonic storm", "#ffc107"],
  SCS: ["Severe cyclonic storm", "#ff9800"],
  VSCS: ["Very severe cyclonic storm", "#f44336"],
  ESCS: ["Extremely severe cyclonic storm", "#b71c1c"],
  SUCS: ["Super cyclonic storm", "#6a1b9a"],
};
const stage = (t) => STAGES[String(t || "").toUpperCase().replace(/[^A-Z]/g, "")] || [t || "Track point", "#9e9e9e"];

let cached = null; // { at, data }

export async function fetchTrack() {
  if (cached && Date.now() - cached.at < TTL) return cached.data;
  const res = await fetch(`${WFS}&t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  cached = { at: Date.now(), data };
  return data;
}

// Some servers answer with lat/lon swapped; India sits at lon 60–100, lat 0–30.
const fix = ([a, b]) => (a < 40 && b > 50 ? [a, b] : [b, a]); // -> [lat, lon]

/**
 * A Leaflet layer of the track (points by stage, joined in order per cyclone),
 * or null when there's no active cyclone. Returns { layer, text }.
 */
export function trackLayer(L, data) {
  const feats = (data?.features || []).filter((f) => f.geometry);
  if (!feats.length) return { layer: null, text: "No active cyclone or depression on IMD's track map." };
  const group = L.layerGroup();
  const byStorm = new Map();
  for (const f of feats) {
    const g = f.geometry;
    const p = f.properties || {};
    const [label, colour] = stage(p.cyclone_type);
    if (g.type === "Point") {
      const ll = fix(g.coordinates);
      const list = byStorm.get(p.cyclone_id) || [];
      list.push({ id: p.id ?? f.id, ll });
      byStorm.set(p.cyclone_id, list);
      L.circleMarker(ll, { radius: 6, weight: 2, color: "#111", fillColor: colour, fillOpacity: 1 })
        .bindTooltip(label)
        .addTo(group);
    } else if (g.type === "LineString" || g.type === "MultiLineString") {
      const lines = g.type === "LineString" ? [g.coordinates] : g.coordinates;
      for (const line of lines) L.polyline(line.map(fix), { color: colour, weight: 3 }).bindTooltip(label).addTo(group);
    }
  }
  for (const pts of byStorm.values()) {
    if (pts.length < 2) continue;
    pts.sort((a, b) => (a.id > b.id ? 1 : -1));
    L.polyline(
      pts.map((p) => p.ll),
      { color: "#111", weight: 2, dashArray: "6 4", interactive: false }
    ).addTo(group);
  }
  const n = byStorm.size || 1;
  return {
    layer: group,
    text: `IMD cyclone track: ${n === 1 ? "one system" : `${n} systems`} (colour by stage). IMD's forecast cone is on the track picture under Cyclones.`,
  };
}
