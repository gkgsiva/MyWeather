// The coasts around the Bay of Bengal and the Arabian Sea as lines through
// the places IMD names in its cyclone bulletins ("cross … between Nellore and
// Tuni"), in order along the shore. Used by Cyclone watch to draw IMD's
// landfall zone, to find where a forecast or model track meets the coast, and
// to name the nearest place. Positions are on the shore, to about 5 km; the
// lines between them are straight, so a crossing found on them is good to
// about 20 km, which is finer than any forecast.
//
// [name, lat, lon, state or country]; `aka` lists other spellings IMD uses.
const EAST = [
  ["Kanyakumari", 8.08, 77.55, "Tamil Nadu"],
  ["Tiruchendur", 8.5, 78.13, "Tamil Nadu"],
  ["Thoothukudi", 8.8, 78.16, "Tamil Nadu"],
  ["Rameswaram", 9.28, 79.3, "Tamil Nadu"],
  ["Thondi", 9.74, 79.03, "Tamil Nadu"],
  ["Point Calimere", 10.29, 79.86, "Tamil Nadu"],
  ["Vedaranyam", 10.38, 79.87, "Tamil Nadu"],
  ["Nagapattinam", 10.77, 79.85, "Tamil Nadu"],
  ["Karaikal", 10.92, 79.85, "Puducherry"],
  ["Cuddalore", 11.74, 79.78, "Tamil Nadu"],
  ["Puducherry", 11.93, 79.84, "Puducherry"],
  ["Marakkanam", 12.2, 79.96, "Tamil Nadu"],
  ["Mamallapuram", 12.62, 80.2, "Tamil Nadu"],
  ["Chennai", 13.08, 80.3, "Tamil Nadu"],
  ["Pulicat", 13.42, 80.33, "Tamil Nadu"],
  ["Sriharikota", 13.72, 80.24, "Andhra Pradesh"],
  ["Nellore", 14.42, 80.17, "Andhra Pradesh"],
  ["Kavali", 14.92, 80.1, "Andhra Pradesh"],
  ["Ongole", 15.48, 80.17, "Andhra Pradesh"],
  ["Bapatla", 15.86, 80.52, "Andhra Pradesh"],
  ["Nizampatnam", 15.9, 80.67, "Andhra Pradesh"],
  ["Machilipatnam", 16.17, 81.17, "Andhra Pradesh"],
  ["Narsapur", 16.32, 81.72, "Andhra Pradesh"],
  ["Yanam", 16.73, 82.24, "Puducherry"],
  ["Kakinada", 16.95, 82.27, "Andhra Pradesh"],
  ["Tuni", 17.3, 82.62, "Andhra Pradesh"],
  ["Visakhapatnam", 17.69, 83.3, "Andhra Pradesh"],
  ["Kalingapatnam", 18.33, 84.12, "Andhra Pradesh"],
  ["Palasa", 18.75, 84.5, "Andhra Pradesh"],
  ["Gopalpur", 19.26, 84.92, "Odisha"],
  ["Puri", 19.8, 85.83, "Odisha"],
  ["Paradip", 20.27, 86.68, "Odisha"],
  ["Dhamra", 20.8, 86.97, "Odisha"],
  ["Balasore", 21.45, 87.08, "Odisha"],
  ["Digha", 21.62, 87.53, "West Bengal"],
  ["Sagar Island", 21.65, 88.07, "West Bengal"],
  ["Khepupara", 21.85, 90.15, "Bangladesh"],
  ["Chittagong", 22.25, 91.78, "Bangladesh"],
  ["Cox's Bazar", 21.43, 91.97, "Bangladesh"],
  ["Teknaf", 20.86, 92.3, "Bangladesh"],
  ["Sittwe", 20.13, 92.9, "Myanmar"],
  ["Kyaukpyu", 19.43, 93.55, "Myanmar"],
  ["Thandwe", 18.46, 94.36, "Myanmar"],
];
const WEST = [
  ["Kanyakumari", 8.08, 77.55, "Tamil Nadu"],
  ["Thiruvananthapuram", 8.48, 76.92, "Kerala"],
  ["Kollam", 8.88, 76.58, "Kerala"],
  ["Alappuzha", 9.49, 76.32, "Kerala"],
  ["Kochi", 9.97, 76.24, "Kerala"],
  ["Kozhikode", 11.25, 75.77, "Kerala"],
  ["Kannur", 11.87, 75.36, "Kerala"],
  ["Mangaluru", 12.87, 74.83, "Karnataka"],
  ["Udupi", 13.34, 74.7, "Karnataka"],
  ["Karwar", 14.8, 74.12, "Karnataka"],
  ["Panaji", 15.49, 73.81, "Goa"],
  ["Ratnagiri", 16.99, 73.28, "Maharashtra"],
  ["Harihareshwar", 17.99, 73.01, "Maharashtra"],
  ["Alibag", 18.64, 72.87, "Maharashtra"],
  ["Mumbai", 18.94, 72.82, "Maharashtra"],
  ["Dahanu", 19.97, 72.71, "Maharashtra"],
  ["Daman", 20.4, 72.83, "Daman"],
  ["Mahuva", 21.08, 71.78, "Gujarat"],
  ["Diu", 20.71, 70.98, "Diu"],
  ["Veraval", 20.9, 70.36, "Gujarat"],
  ["Porbandar", 21.63, 69.6, "Gujarat"],
  ["Dwarka", 22.24, 68.96, "Gujarat"],
  ["Mandvi", 22.83, 69.35, "Gujarat"],
  ["Jakhau", 23.22, 68.7, "Gujarat"],
  ["Karachi", 24.84, 66.98, "Pakistan"],
];
const LANKA = [
  ["Point Pedro", 9.83, 80.23, "Sri Lanka"],
  ["Mullaitivu", 9.27, 80.82, "Sri Lanka"],
  ["Trincomalee", 8.57, 81.24, "Sri Lanka"],
  ["Batticaloa", 7.72, 81.7, "Sri Lanka"],
  ["Pottuvil", 6.87, 81.84, "Sri Lanka"],
  ["Hambantota", 6.12, 81.12, "Sri Lanka"],
];

const AKA = {
  Mahabalipuram: "Mamallapuram",
  Pondicherry: "Puducherry",
  Puduchery: "Puducherry",
  Mangalore: "Mangaluru",
  Vizag: "Visakhapatnam",
  Calicut: "Kozhikode",
  Cochin: "Kochi",
  Tuticorin: "Thoothukudi",
  Chattogram: "Chittagong",
  Paradeep: "Paradip",
  Kodiakkarai: "Point Calimere",
  Panjim: "Panaji",
  "Sagar Islands": "Sagar Island",
};

const toPlace = ([name, lat, lon, state]) => ({ name, lat, lon, state });
export const COASTS = [EAST, WEST, LANKA].map((line) => line.map(toPlace));
export const PLACES = COASTS.flat();

// A place by the name IMD uses, or null.
export function placeNamed(name) {
  const n = String(name || "").trim().replace(/\s+/g, " ");
  const want = (AKA[n] || n).toLowerCase();
  return PLACES.find((p) => p.name.toLowerCase() === want) || null;
}

// The stretch of shore between two named places (both on the same coast), as
// [lat, lon] points, or null.
export function shoreBetween(a, b) {
  const A = placeNamed(a);
  const B = placeNamed(b);
  if (!A || !B) return null;
  for (const line of COASTS) {
    const i = line.findIndex((p) => p.name === A.name);
    const j = line.findIndex((p) => p.name === B.name);
    if (i < 0 || j < 0) continue;
    const [s, e] = i < j ? [i, j] : [j, i];
    return line.slice(s, e + 1).map((p) => [p.lat, p.lon]);
  }
  return null;
}

// A stretch of shore about `half` km either side of a point on a coast.
export function shoreAround(pt, half, km) {
  let best = null;
  for (const line of COASTS) {
    for (let i = 0; i < line.length - 1; i++) {
      const c = closestOnSegment(pt, [line[i].lat, line[i].lon], [line[i + 1].lat, line[i + 1].lon]);
      const d = km(pt, c.p);
      if (!best || d < best.d) best = { d, line, i, p: c.p };
    }
  }
  if (!best) return null;
  const pts = [best.p];
  const walk = (step) => {
    let left = half;
    let at = best.p;
    for (let k = step > 0 ? best.i + 1 : best.i; k >= 0 && k < best.line.length; k += step) {
      const next = [best.line[k].lat, best.line[k].lon];
      const d = km(at, next);
      if (d >= left) {
        const f = left / d;
        const end = [at[0] + (next[0] - at[0]) * f, at[1] + (next[1] - at[1]) * f];
        step > 0 ? pts.push(end) : pts.unshift(end);
        return;
      }
      step > 0 ? pts.push(next) : pts.unshift(next);
      left -= d;
      at = next;
    }
  };
  walk(1);
  walk(-1);
  return pts;
}

// The nearest named place to a point, with its distance in km.
export function nearestPlace(pt, km) {
  let best = null;
  for (const p of PLACES) {
    const d = km(pt, [p.lat, p.lon]);
    if (!best || d < best.km) best = { ...p, km: d };
  }
  return best;
}

export function closestOnSegment(p, a, b) {
  const dx = b[1] - a[1];
  const dy = b[0] - a[0];
  const len = dx * dx + dy * dy;
  let t = len ? ((p[1] - a[1]) * dx + (p[0] - a[0]) * dy) / len : 0;
  t = Math.max(0, Math.min(1, t));
  return { t, p: [a[0] + dy * t, a[1] + dx * t] };
}

// Where segment p→q (each [lat, lon]) first meets any coast: { f, pt } where
// f is how far along p→q (0–1), or null. Flat-earth maths is fine at this size.
export function meetsCoast(p, q) {
  let best = null;
  for (const line of COASTS) {
    for (let i = 0; i < line.length - 1; i++) {
      const a = [line[i].lat, line[i].lon];
      const b = [line[i + 1].lat, line[i + 1].lon];
      const r = [q[1] - p[1], q[0] - p[0]];
      const s = [b[1] - a[1], b[0] - a[0]];
      const den = r[0] * s[1] - r[1] * s[0];
      if (!den) continue;
      const w = [a[1] - p[1], a[0] - p[0]];
      const t = (w[0] * s[1] - w[1] * s[0]) / den;
      const u = (w[0] * r[1] - w[1] * r[0]) / den;
      if (t < 0 || t > 1 || u < 0 || u > 1) continue;
      if (!best || t < best.f) best = { f: t, pt: [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t] };
    }
  }
  return best;
}
