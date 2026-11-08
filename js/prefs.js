// App-wide preferences set on the Settings screen (js/settingsview.js) and
// read by the other screens. Small and free of other imports, so any screen
// can use it without pulling in more code at start.
import { TN_DISTRICTS } from "./districts.js";

export const DISTRICT_KEY = "myweather.settings.district";
export const UNITS_KEY = "myweather.settings.units"; // { temp: "c" | "f", wind: "kmh" | "kn" | "mph" | "ms" }
export const HIDDEN_KEY = "myweather.menu.hidden"; // [view names]

const read = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
};

const norm = (s) => String(s).toLowerCase().replace(/[^a-z]/g, "");

// ---- Home district ----

/** The home district's name as TN_DISTRICTS spells it (Chennai unless changed). */
export function homeDistrict() {
  const d = read(DISTRICT_KEY, "Chennai");
  return TN_DISTRICTS.some(([n]) => n === d) ? d : "Chennai";
}

export function setHomeDistrict(name) {
  write(DISTRICT_KEY, name);
}

/**
 * The value among a screen's options that names the home district, matched
 * loosely ("THIRUVALLUR" ~ "Tiruvallur", "Kanniyakumari" ~ "Kanyakumari").
 * options: [{ value, text }] or <option>s. Returns null when none matches.
 */
export function matchDistrict(options, name = homeDistrict()) {
  const want = norm(name);
  // Spellings that differ more than case and punctuation.
  const alias = (s) =>
    s
      .replace(/^thiru/, "tiru")
      .replace(/^tiruchirappalli$|^tiruchirapalli$|^trichy$/, "tiruchirappalli")
      .replace(/^tuticorin$/, "thoothukudi")
      .replace(/^kanyakumari$/, "kanniyakumari")
      .replace(/^kanchipuram$/, "kancheepuram")
      .replace(/^thepnilgiris$|^thenilgiris$/, "nilgiris")
      .replace(/^tirupattur$/, "tirupathur")
      .replace(/^ranippettai$/, "ranipet")
      .replace(/^sivaganga$/, "sivagangai")
      .replace(/^villuppuram$/, "villupuram");
  const target = alias(want);
  for (const o of options) {
    const keys = [o.value, o.text].map((s) => alias(norm(s)));
    if (keys.includes(target)) return o.value;
  }
  return null;
}

/** The home district's centre: { lat, lon, name }. */
export function homePlace() {
  const name = homeDistrict();
  const d = TN_DISTRICTS.find(([n]) => n === name);
  // Chennai's centre is the city itself, as the screens always used.
  if (!d || name === "Chennai") return { lat: 13.08, lon: 80.27, name: "Chennai" };
  return { lat: d[1], lon: d[2], name };
}

// ---- Units ----

export function units() {
  const u = read(UNITS_KEY, {});
  return {
    temp: u.temp === "f" ? "f" : "c",
    wind: ["kn", "mph", "ms"].includes(u.wind) ? u.wind : "kmh",
  };
}

export function setUnits(u) {
  write(UNITS_KEY, { ...units(), ...u });
}

/** A °C value in the chosen unit (a number), or the input if not a number. */
export const toTemp = (c) => (typeof c === "number" && units().temp === "f" ? (c * 9) / 5 + 32 : c);
/** "°C" or "°F". */
export const tempUnit = () => (units().temp === "f" ? "°F" : "°C");
/** A difference of °C in the chosen unit. */
export const toTempDelta = (c) => (typeof c === "number" && units().temp === "f" ? (c * 9) / 5 : c);

const WIND = { kmh: [1, "km/h"], kn: [1 / 1.852, "kn"], mph: [1 / 1.609344, "mph"], ms: [1 / 3.6, "m/s"] };
/** A km/h value in the chosen unit. */
export const toWind = (kmh) => (typeof kmh === "number" ? kmh * WIND[units().wind][0] : kmh);
/** "km/h", "kn", "mph" or "m/s". */
export const windUnit = () => WIND[units().wind][1];

// ---- Menu ----

export function hiddenViews() {
  const h = read(HIDDEN_KEY, []);
  return new Set(Array.isArray(h) ? h : []);
}

export function setHiddenViews(set) {
  write(HIDDEN_KEY, [...set]);
}
