// Forecast vs what happened, the arithmetic (no page needed). Every forecast
// an agency issued for a storm is kept by the hourly cyclone workflow in
// cyclone/archive.json (scripts/cyclone_archive.py) with where the storm
// really was. Each forecast point whose time has come is compared with the
// storm's position then, read between the two nearest recorded positions; the
// distance between them is the error in km. Nothing is guessed: a point with
// no recorded position near its time has no error ("not yet" or "no position").
import { km } from "./geo.js";

export const HOUR = 3600 * 1000;
const NEAR = 1.5 * HOUR; // a recorded position this close counts as "at" the time
const GAP = 12 * HOUR; // positions further apart than this aren't joined up
export const LEADS = [
  { label: "Up to 12 h", max: 12 },
  { label: "12–24 h", max: 24 },
  { label: "24–48 h", max: 48 },
  { label: "48–72 h", max: 72 },
  { label: "Over 72 h", max: Infinity },
];

// Where the storm was at ms time t: [lat, lon, km/h], or null when no
// recorded position is close enough in time.
export function observedAt(obs, t) {
  let before = null;
  let after = null;
  for (const o of obs) {
    const ot = Date.parse(o[0]);
    if (ot <= t) before = { o, t: ot };
    else if (!after) after = { o, t: ot };
  }
  const row = (a) => [a.o[1], a.o[2], a.o[3]];
  if (before && t - before.t <= NEAR) return row(before);
  if (after && after.t - t <= NEAR) return row(after);
  if (before && after && after.t - before.t <= GAP) {
    const f = (t - before.t) / (after.t - before.t);
    const mix = (x, y) => x + (y - x) * f;
    const [a, b] = [before.o, after.o];
    return [mix(a[1], b[1]), mix(a[2], b[2]), a[3] != null && b[3] != null ? mix(a[3], b[3]) : null];
  }
  return null;
}

// One forecast against the storm's recorded positions.
export function checkForecast(storm, fc) {
  const base = Date.parse(fc.base);
  const lastObs = storm.obs.length ? Date.parse(storm.obs[storm.obs.length - 1][0]) : 0;
  return fc.pts.map((p) => {
    const t = Date.parse(p[0]);
    const o = observedAt(storm.obs, t);
    return {
      t,
      lead: (t - base) / HOUR,
      lat: p[1],
      lon: p[2],
      kmh: p[3],
      obs: o,
      err: o ? km([p[1], p[2]], [o[0], o[1]]) : null,
      state: o ? "done" : t > lastObs ? "pending" : "missing",
    };
  });
}

// Average error by how far ahead the forecast looked, over all of the
// storm's forecasts: [{label, n, mean, worst}].
export function leadStats(storm) {
  const out = LEADS.map((l) => ({ ...l, errs: [] }));
  for (const fc of storm.fc) {
    for (const p of checkForecast(storm, fc)) {
      if (p.err == null || p.lead <= 0) continue;
      out.find((l) => p.lead <= l.max).errs.push(p.err);
    }
  }
  return out
    .filter((l) => l.errs.length)
    .map((l) => ({ label: l.label, n: l.errs.length, mean: l.errs.reduce((a, b) => a + b, 0) / l.errs.length, worst: Math.max(...l.errs) }));
}
