// Rain nowcast: when the rain on the radar will reach a place, if it keeps
// moving the way it has over the last hour.
//
// The radar map (js/radarmap.js) lifts the rain out of IMD's loop and works
// out its movement. From there the sum is simple: look "upstream" of the
// place, against the movement, 5 minutes at a time. If the rain now lying
// there carries on at the same speed and heading, it arrives in that many
// minutes. Rain grows, dies and turns, so the answer is a rough guide for the
// next hour or two, not a forecast; beyond two hours it isn't tried.
//
// The last answer is kept on the phone, so Home can show it without
// downloading the loop again.

const SAVED_KEY = "myweather.nowcast.last";
const STEP_MIN = 5;
const MAX_MIN = 120;
const KM_PER_DEG = 111.2;

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const COMPASS_WORDS = { N: "north", NE: "northeast", E: "east", SE: "southeast", S: "south", SW: "southwest", W: "west", NW: "northwest" };
const compass = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

// Moves (lat, lon) by (east, north) km.
export function offset(lat, lon, eastKm, northKm) {
  return [lat + northKm / KM_PER_DEG, lon + eastKm / (KM_PER_DEG * Math.cos((lat * Math.PI) / 180))];
}

export function distanceKm(a, b) {
  const dy = (b[0] - a[0]) * KM_PER_DEG;
  const dx = (b[1] - a[1]) * KM_PER_DEG * Math.cos((((a[0] + b[0]) / 2) * Math.PI) / 180);
  return Math.hypot(dx, dy);
}

/**
 * grid: { mask (Uint8Array, 1 = rain), w, h, toPx(lat, lon) -> [x, y], kmPerPx }
 * motion: { vx, vy (km/h east and north), speed } or null
 * Returns {
 *   raining: rain over the place now,
 *   eta: minutes until rain arrives (0 when raining), or null,
 *   lasts: minutes of rain passing over after it arrives (a lower bound when it runs past the radar's edge), or null,
 *   nearest: { km, toward (compass point from the place) } of the closest rain now, or null,
 *   edge: true when looking upstream ran off the radar's picture before 2 hours,
 *   still: true when the rain is barely moving (under 5 km/h),
 * }
 */
export function nowcastAt(grid, motion, lat, lon) {
  const { mask, w, h, toPx, kmPerPx } = grid;
  const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h;

  // Share of rain pixels within r km of a point; null when off the picture.
  const rainNear = (la, lo, rKm) => {
    const [cx, cy] = toPx(la, lo);
    if (!inside(Math.round(cx), Math.round(cy))) return null;
    const r = Math.max(1, rKm / kmPerPx);
    let n = 0;
    let wet = 0;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 > r * r || !inside(x, y)) continue;
        n++;
        if (mask[y * w + x]) wet++;
      }
    return n ? wet / n : null;
  };

  // The closest rain to the place, within 150 km.
  let nearest = null;
  {
    const [cx, cy] = toPx(lat, lon);
    const reach = 150 / kmPerPx;
    let best = Infinity;
    let bx = 0;
    let by = 0;
    const x0 = Math.max(0, Math.floor(cx - reach));
    const x1 = Math.min(w - 1, Math.ceil(cx + reach));
    const y0 = Math.max(0, Math.floor(cy - reach));
    const y1 = Math.min(h - 1, Math.ceil(cy + reach));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (!mask[y * w + x]) continue;
        const d = (x - cx) ** 2 + (y - cy) ** 2;
        if (d < best) {
          best = d;
          bx = x;
          by = y;
        }
      }
    if (best < Infinity) {
      const km = Math.sqrt(best) * kmPerPx;
      // Picture y grows southward.
      const deg = (Math.atan2(bx - cx, cy - by) * 180) / Math.PI;
      nearest = { km, toward: compass(deg) };
    }
  }

  const here = rainNear(lat, lon, 3);
  const raining = here !== null && here >= 0.25;
  const still = !motion || motion.speed < 5;
  const out = { raining, eta: raining ? 0 : null, lasts: null, nearest, edge: false, still };
  if (here === null) {
    out.edge = true;
    return out;
  }
  if (still) return out;

  // Walk upstream. The circle widens with time, as the heading is less sure.
  let start = raining ? 0 : null;
  let end = null;
  for (let t = STEP_MIN; t <= MAX_MIN; t += STEP_MIN) {
    const back = t / 60;
    const [la, lo] = offset(lat, lon, -motion.vx * back, -motion.vy * back);
    const share = rainNear(la, lo, 3 + t * 0.04);
    if (share === null) {
      out.edge = true;
      if (start !== null && end === null) end = t; // ran off with rain still coming
      break;
    }
    const wet = share >= 0.25;
    if (wet && start === null) start = t;
    if (!wet && start !== null && end === null) {
      end = t;
      break;
    }
  }
  if (start !== null) {
    out.eta = start;
    out.lasts = (end ?? MAX_MIN + STEP_MIN) - start;
  }
  return out;
}

const roundMin = (m) => (m < 15 ? `${Math.max(5, Math.round(m / 5) * 5)} min` : m < 60 ? `${Math.round(m / 5) * 5} min` : `${Math.floor(m / 60)} h ${String(Math.round((m % 60) / 5) * 5).padStart(2, "0")} min`);

/** One line, e.g. "Rain likely in about 40 min, for about 25 min". */
export function headline(r) {
  if (!r) return "No nowcast yet.";
  if (r.raining) {
    if (r.still) return "Raining here now; the rain is barely moving.";
    return r.lasts && r.lasts <= 120 ? `Raining here now, likely for about another ${roundMin(r.lasts)}.` : "Raining here now.";
  }
  if (r.eta !== null) {
    const lasting = r.lasts && r.lasts <= 120 ? `, for about ${roundMin(r.lasts)}` : "";
    return `Rain likely in about ${roundMin(r.eta)}${lasting}.`;
  }
  if (r.nearest && r.nearest.km < 150) {
    const where = `${Math.round(r.nearest.km)} km to the ${COMPASS_WORDS[r.nearest.toward]}`;
    return r.still ? `No rain here. Nearest rain ${where}, barely moving.` : `No rain heading here in the next 2 hours. Nearest rain ${where}.`;
  }
  return r.edge ? "No rain on the radar near here." : "No rain on the radar within 150 km.";
}

// ---- Saved answer ----

/** { at (ms), frame (ms|null), place, lat, lon, radar, result } */
export function saveNowcast(entry) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(entry));
  } catch {}
}

export function loadNowcast() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVED_KEY));
    return s && s.at && s.result ? s : null;
  } catch {
    return null;
  }
}
