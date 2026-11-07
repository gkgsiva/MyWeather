// Sunrise, sunset, moonrise, moonset and the moon's phase, worked out on the
// phone (no network). The formulas are the usual low-precision ones (after
// Jean Meeus' "Astronomical Algorithms", as used by many almanac apps), good to
// a minute or two for the sun and a few minutes for the moon.

const RAD = Math.PI / 180;
const DAY_MS = 86400000;
const J1970 = 2440588;
const J2000 = 2451545;
const OBLIQUITY = RAD * 23.4397;

const toJulian = (date) => date.valueOf() / DAY_MS - 0.5 + J1970;
const fromJulian = (j) => new Date((j + 0.5 - J1970) * DAY_MS);
const toDays = (date) => toJulian(date) - J2000;

const rightAscension = (l, b) => Math.atan2(Math.sin(l) * Math.cos(OBLIQUITY) - Math.tan(b) * Math.sin(OBLIQUITY), Math.cos(l));
const declination = (l, b) => Math.asin(Math.sin(b) * Math.cos(OBLIQUITY) + Math.cos(b) * Math.sin(OBLIQUITY) * Math.sin(l));
const siderealTime = (d, lw) => RAD * (280.16 + 360.9856235 * d) - lw;
const altitude = (H, phi, dec) => Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));

// ---- Sun ----

const solarMeanAnomaly = (d) => RAD * (357.5291 + 0.98560028 * d);
function eclipticLongitude(M) {
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  return M + C + RAD * 102.9372 + Math.PI;
}
function sunCoords(d) {
  const L = eclipticLongitude(solarMeanAnomaly(d));
  return { dec: declination(L, 0), ra: rightAscension(L, 0) };
}

const J0 = 0.0009;
const julianCycle = (d, lw) => Math.round(d - J0 - lw / (2 * Math.PI));
const approxTransit = (Ht, lw, n) => J0 + (Ht + lw) / (2 * Math.PI) + n;
const solarTransitJ = (ds, M, L) => J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
const hourAngle = (h, phi, d) => Math.acos((Math.sin(h) - Math.sin(phi) * Math.sin(d)) / (Math.cos(phi) * Math.cos(d)));

// Sunrise, sunset and solar noon on the day of `date`, at lat/lon in degrees.
// Twilight (sun 6° below the horizon) is the "first light" and "last light".
export function sunTimes(date, lat, lon) {
  const lw = RAD * -lon;
  const phi = RAD * lat;
  // Noon local time keeps the right day for India (UTC+5:30).
  const noon = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  const d = toDays(noon);
  const n = julianCycle(d, lw);
  const ds = approxTransit(0, lw, n);
  const M = solarMeanAnomaly(ds);
  const L = eclipticLongitude(M);
  const dec = declination(L, 0);
  const Jnoon = solarTransitJ(ds, M, L);
  const at = (h) => {
    const w = hourAngle(h * RAD, phi, dec);
    if (Number.isNaN(w)) return [null, null];
    const Jset = solarTransitJ(approxTransit(w, lw, n), M, L);
    return [fromJulian(Jnoon - (Jset - Jnoon)), fromJulian(Jset)];
  };
  const [sunrise, sunset] = at(-0.833);
  const [dawn, dusk] = at(-6);
  return { sunrise, sunset, dawn, dusk, noon: fromJulian(Jnoon) };
}

// ---- Moon ----

function moonCoords(d) {
  const L = RAD * (218.316 + 13.176396 * d);
  const M = RAD * (134.963 + 13.064993 * d);
  const F = RAD * (93.272 + 13.22935 * d);
  const l = L + RAD * 6.289 * Math.sin(M);
  const b = RAD * 5.128 * Math.sin(F);
  return { ra: rightAscension(l, b), dec: declination(l, b), dist: 385001 - 20905 * Math.cos(M) };
}

function moonAltitude(date, lat, lon) {
  const lw = RAD * -lon;
  const phi = RAD * lat;
  const d = toDays(date);
  const c = moonCoords(d);
  const H = siderealTime(d, lw) - c.ra;
  const h = altitude(H, phi, c.dec);
  // Parallax: the moon is close enough to look lower than from Earth's centre.
  return h - Math.asin(6378.14 / c.dist) * Math.cos(h);
}

// Moonrise and moonset during the local day of `date` (either may be null:
// about once a month the moon doesn't rise, or doesn't set, on a given day).
export function moonTimes(date, lat, lon) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const h0 = 0.133 * RAD; // refraction and the moon's radius
  const STEP = 10 * 60000;
  let rise = null;
  let set = null;
  let t = start.valueOf();
  let prev = moonAltitude(new Date(t), lat, lon) - h0;
  for (let i = 1; i <= 144; i++) {
    const t2 = t + STEP;
    const cur = moonAltitude(new Date(t2), lat, lon) - h0;
    if (prev < 0 && cur >= 0 && !rise) rise = new Date(t + (STEP * -prev) / (cur - prev));
    if (prev >= 0 && cur < 0 && !set) set = new Date(t + (STEP * prev) / (prev - cur));
    prev = cur;
    t = t2;
  }
  return { rise, set };
}

// fraction: lit part (0..1); phase: 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter.
export function moonIllumination(date = new Date()) {
  const d = toDays(date);
  const s = sunCoords(d);
  const m = moonCoords(d);
  const sdist = 149598000;
  const phi = Math.acos(Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra));
  const inc = Math.atan2(sdist * Math.sin(phi), m.dist - sdist * Math.cos(phi));
  const angle = Math.atan2(
    Math.cos(s.dec) * Math.sin(s.ra - m.ra),
    Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra)
  );
  return { fraction: (1 + Math.cos(inc)) / 2, phase: 0.5 + (0.5 * inc * (angle < 0 ? -1 : 1)) / Math.PI };
}

const PHASES = [
  [0.033, "New moon", "🌑"],
  [0.216, "Waxing crescent", "🌒"],
  [0.284, "First quarter", "🌓"],
  [0.466, "Waxing gibbous", "🌔"],
  [0.534, "Full moon", "🌕"],
  [0.716, "Waning gibbous", "🌖"],
  [0.784, "Last quarter", "🌗"],
  [0.967, "Waning crescent", "🌘"],
  [1.01, "New moon", "🌑"],
];
export function phaseName(phase) {
  const [, name, icon] = PHASES.find(([max]) => phase < max);
  return { name, icon };
}

// The next full and new moon after `date`, to the nearest hour or so.
export function nextPhases(date = new Date()) {
  const out = {};
  const age = (t) => moonIllumination(new Date(t)).phase;
  let t = date.valueOf();
  let prev = age(t);
  for (let i = 0; i < 24 * 31 && !(out.full && out.new); i++) {
    const t2 = t + 3600000;
    const cur = age(t2);
    if (!out.full && prev < 0.5 && cur >= 0.5) out.full = new Date(t2);
    if (!out.new && cur < prev - 0.5) out.new = new Date(t2); // wrapped past 1 → 0
    prev = cur;
    t = t2;
  }
  return out;
}
