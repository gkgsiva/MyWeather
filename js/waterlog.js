// Waterlogging risk by Chennai zone, on the Flood spots screen: each of
// Greater Chennai Corporation's 15 zones rated low, medium or high from
//   - rain in the last 24 hours and the last 3 hours at the zone's GCC rain
//     gauges (TN-SMART, the "Z 01 …" stations), as a zone mean;
//   - rain on its way in the next hour (the radar nowcast at the zone's centre,
//     only when the radar was read in the last 15 minutes: nothing extra is
//     downloaded);
//   - how many known flood spots (js/flood-spots.js) lie in the zone;
//   - the lakes upstream when nearly full (Chembarambakkam drains to the Adyar
//     zones, Puzhal and Poondi to the north Chennai zones), from the daily
//     TN-SMART reservoir report.
// Points: 24 h rain 30 / 65 / 115 mm = 1 / 2 / 3; 3 h rain 20 / 45 mm = 1 / 2;
// rain within the hour 1; 3+ flood spots 1; an upstream lake 90% full 1.
// High from 4 points (or 115 mm in 24 h), medium from 2. A rough guide, not a
// flood warning.
import { BASE, currentRainDay, shiftDay } from "./gaugedays.js";
import { FLOOD_SPOTS } from "./flood-spots.js";
import { latestLakes } from "./laketrend.js";
import { mosaicCached } from "./mosaic.js";
import { nowcastAt } from "./nowcast.js";

export const ZONES = [
  "Thiruvottiyur", "Manali", "Madhavaram", "Tondiarpet", "Royapuram", "Thiru. Vi. Ka. Nagar", "Ambattur", "Anna Nagar",
  "Teynampet", "Kodambakkam", "Valasaravakkam", "Alandur", "Adyar", "Perungudi", "Sholinganallur",
];
// Zones downstream of each lake (by zone number).
const LAKE_ZONES = {
  Chembarambakkam: [10, 11, 12, 13],
  "Puzhal (Red Hills)": [1, 2, 3, 4, 6],
  Poondi: [1, 2],
};

const hourKeys = (row) => Object.keys(row).filter((k) => /^\d\d:\d\d [AP]M$/.test(k));

async function rows(day) {
  const running = day >= currentRainDay();
  const res = await fetch(`${BASE}hourly_rainfall_${day}.json${running ? `?t=${Date.now()}` : ""}`, { cache: running ? "no-store" : "default" });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Each Chennai gauge's last 24 hours of hourly rain (oldest first).
async function chennaiGauges() {
  const today = currentRainDay();
  const [prev, now] = await Promise.all([rows(shiftDay(today, -1)).catch(() => []), rows(today)]);
  const pick = (list) => list.filter((r) => r.district_name === "Chennai" && /^Z \d\d/.test(r.station_name));
  const series = new Map();
  for (const list of [pick(prev), pick(now)]) {
    for (const r of list) {
      const s = series.get(r.station_name) || { name: r.station_name, lat: r.latitude, lon: r.longitude, v: [] };
      for (const k of hourKeys(r)) s.v.push(r[k]);
      series.set(r.station_name, s);
    }
  }
  // Trim to the last hour any gauge reported, then the 24 before it.
  let last = 0;
  for (const s of series.values()) for (let i = s.v.length - 1; i >= 0; i--) if (typeof s.v[i] === "number") {
    last = Math.max(last, i + 1);
    break;
  }
  return [...series.values()].map((s) => ({ ...s, v: s.v.slice(Math.max(0, last - 24), last) }));
}

const sum = (a) => a.reduce((x, y) => x + (typeof y === "number" ? y : 0), 0);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

/** [{ zone, name, rain24, rain3, soon, spots, lakes: [names], points, level, why: [text] }] */
export async function zoneRisk() {
  const [gauges, lakes] = await Promise.all([chennaiGauges(), latestLakes().catch(() => null)]);
  const byZone = new Map();
  for (const g of gauges) {
    const z = Number(g.name.slice(2, 4));
    if (!byZone.has(z)) byZone.set(z, []);
    byZone.get(z).push(g);
  }
  // Each flood spot goes to the zone of its nearest gauge.
  const spotZones = new Map();
  for (const s of FLOOD_SPOTS) {
    let best = null;
    let bestD = Infinity;
    for (const g of gauges) {
      const d = (g.lat - s.lat) ** 2 + ((g.lon - s.lon) * 0.97) ** 2;
      if (d < bestD) {
        bestD = d;
        best = g;
      }
    }
    if (best && bestD < 0.0016) {
      const z = Number(best.name.slice(2, 4));
      spotZones.set(z, (spotZones.get(z) || 0) + 1);
    }
  }
  const full = Object.entries(lakes?.lakes || {})
    .filter(([, [st, cap]]) => cap && st / cap >= 0.9)
    .map(([n]) => n);
  // The radar, only if already read.
  let mosaic = null;
  const pending = mosaicCached();
  if (pending) mosaic = await pending.catch(() => null);
  const last = mosaic?.frames[mosaic.frames.length - 1];
  const fresh = last && Date.now() - last.time.valueOf() < 40 * 60 * 1000;
  const grid = fresh ? mosaic.grid(last) : null;

  return ZONES.map((name, k) => {
    const zone = k + 1;
    const gs = byZone.get(zone) || [];
    const r24 = mean(gs.map((g) => sum(g.v)));
    const r3 = mean(gs.map((g) => sum(g.v.slice(-3))));
    const lat = mean(gs.map((g) => g.lat));
    const lon = mean(gs.map((g) => g.lon));
    let soon = null;
    if (grid && lat !== null) {
      const res = nowcastAt(grid, mosaic.motionAt(lat, lon), lat, lon);
      soon = res.raining || (res.eta !== null && res.eta <= 60) ? (res.raining ? 0 : res.eta) : null;
    }
    const spots = spotZones.get(zone) || 0;
    const zl = full.filter((l) => (LAKE_ZONES[l] || []).includes(zone));
    const why = [];
    let points = 0;
    if (r24 !== null) {
      const p = r24 >= 115 ? 3 : r24 >= 65 ? 2 : r24 >= 30 ? 1 : 0;
      points += p;
      if (p) why.push(`${Math.round(r24)} mm in 24 h`);
    }
    if (r3 !== null) {
      const p = r3 >= 45 ? 2 : r3 >= 20 ? 1 : 0;
      points += p;
      if (p) why.push(`${Math.round(r3)} mm in 3 h`);
    }
    if (soon !== null) {
      points += 1;
      why.push(soon === 0 ? "raining now on the radar" : `rain due in about ${Math.max(5, Math.round(soon / 5) * 5)} min`);
    }
    if (spots >= 3) {
      points += 1;
      why.push(`${spots} known flood spots`);
    }
    if (zl.length) {
      points += 1;
      why.push(`${zl.join(", ")} over 90% full`);
    }
    const level = points >= 4 || (r24 ?? 0) >= 115 ? "high" : points >= 2 ? "medium" : "low";
    return { zone, name, lat, lon, rain24: r24, rain3: r3, soon, spots, lakes: zl, points, level, why, gauges: gs.length };
  });
}
