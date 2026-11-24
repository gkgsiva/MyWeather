// Chennai / Whole Tamil Nadu: which stations the Station map, Neighbourhood
// weather and Compare stations show (Wunderground and Weather Union alike).
// Chennai is anything within ~65 km of the city; the choice is kept on the
// phone and shared by those screens.
const KEY = "myweather.scope";
export const CHENNAI = [13.04, 80.22];
const NEAR_DEG = 0.6;

export function getScope() {
  try {
    return localStorage.getItem(KEY) === "tn" ? "tn" : "chennai";
  } catch {
    return "chennai";
  }
}
export function setScope(v) {
  try {
    localStorage.setItem(KEY, v === "tn" ? "tn" : "chennai");
  } catch {}
}
// A place with no known position is kept in both.
export function inScope(pos, scope = getScope()) {
  if (scope === "tn" || !pos || typeof pos[0] !== "number") return true;
  return Math.abs(pos[0] - CHENNAI[0]) < NEAR_DEG && Math.abs(pos[1] - CHENNAI[1]) < NEAR_DEG;
}
export const SCOPE_OPTIONS = [
  ["chennai", "Chennai"],
  ["tn", "Whole Tamil Nadu"],
];
