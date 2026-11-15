// Problem log: every download that fails (an error, HTTP 400 or more, or no
// answer), every picture that doesn't load and every script error, kept on the
// phone so they can be looked at and sent later (#errors, js/errorsview.js).
//
// Started first thing by js/app.js. It wraps window.fetch, so every screen's
// downloads are covered without changing them, and listens for <img> load
// errors and uncaught errors. Keys and tokens in links (Wunderground's apiKey,
// WAQI's token) are blanked before anything is saved.
//
// Kept in localStorage: the newest 200 entries, a week at most. The same
// problem again within 10 minutes adds to its count instead of a new line.

const KEY = "myweather.errorlog";
const MAX = 200;
const KEEP_MS = 7 * 24 * 3600e3;
const SAME_MS = 10 * 60e3;
const SECRET = /^(api_?key|key|token|apikey|access_token|appid|secret|sig)$/i;

let entries = null;
const listeners = new Set();

function load() {
  if (entries) return entries;
  try {
    const v = JSON.parse(localStorage.getItem(KEY));
    entries = Array.isArray(v) ? v : [];
  } catch {
    entries = [];
  }
  return entries;
}

let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(entries));
    } catch {}
  }, 300);
}

/** A link with keys and tokens blanked and cache-busting ?t= dropped. */
export function cleanUrl(url) {
  try {
    const u = new URL(String(url), location.href);
    for (const k of [...u.searchParams.keys()]) {
      if (SECRET.test(k)) u.searchParams.set(k, "hidden");
      else if (k === "t" || k === "_") u.searchParams.delete(k);
    }
    // WAQI puts its token in the path's query too; blank anything token-like.
    return u.href.replace(/(token=)[^&]+/gi, "$1hidden");
  } catch {
    return String(url).slice(0, 300);
  }
}

const screen = () => location.hash.slice(1).split("?")[0] || "home";

/** Adds a problem: kind ("download" | "picture" | "script"), what (link or place), why. */
export function logProblem(kind, what, why) {
  const list = load();
  const now = Date.now();
  what = String(what || "").slice(0, 400);
  why = String(why || "").slice(0, 300);
  const same = list.find((e) => e.kind === kind && e.what === what && e.why === why && now - e.last < SAME_MS);
  if (same) {
    same.count = (same.count || 1) + 1;
    same.last = now;
  } else {
    list.unshift({ at: now, last: now, kind, what, why, screen: screen(), count: 1, online: navigator.onLine });
  }
  const cut = now - KEEP_MS;
  entries = list.filter((e) => e.last >= cut).slice(0, MAX);
  save();
  for (const fn of listeners) fn();
}

export const problems = () => load().slice();
export function clearProblems() {
  entries = [];
  try {
    localStorage.removeItem(KEY);
  } catch {}
  for (const fn of listeners) fn();
}
export const onProblem = (fn) => listeners.add(fn);

function host(url) {
  try {
    return new URL(url, location.href).host;
  } catch {
    return "";
  }
}

export function initProblemLog() {
  const realFetch = window.fetch?.bind(window);
  if (realFetch && !realFetch.logged) {
    const logged = async (input, init) => {
      const url = typeof input === "string" ? input : input?.url || String(input);
      try {
        const res = await realFetch(input, init);
        if (res.status >= 400) {
          logProblem("download", cleanUrl(url), `HTTP ${res.status}${res.status === 404 ? " (not there, often just not published yet)" : ""}`);
        }
        return res;
      } catch (e) {
        // The app's screens only cancel a download when it takes too long.
        if (e?.name === "AbortError" || e?.name === "TimeoutError") {
          logProblem("download", cleanUrl(url), "no answer in time");
        } else {
          logProblem("download", cleanUrl(url), navigator.onLine ? e?.message || "failed" : "phone is offline");
        }
        throw e;
      }
    };
    logged.logged = true;
    window.fetch = logged;
  }

  // Pictures (radar, satellite, maps…) that don't load. Map tiles are left
  // out: one bad patch of map would fill the log.
  document.addEventListener(
    "error",
    (e) => {
      const el = e.target;
      if (!(el instanceof HTMLImageElement) || !el.src || el.src.startsWith("data:") || el.src.startsWith("blob:")) return;
      if (el.classList.contains("leaflet-tile") || /tile\.openstreetmap/.test(el.src)) return;
      logProblem("picture", cleanUrl(el.src), navigator.onLine ? `didn't load (${host(el.src)})` : "phone is offline");
    },
    true
  );

  window.addEventListener("error", (e) => {
    if (e.target && e.target !== window) return; // resource errors are handled above
    const where = e.filename ? `${e.filename.split("/").pop()}:${e.lineno}` : "page";
    logProblem("script", where, e.message || "error");
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    if (r?.name === "AbortError") return;
    logProblem("script", "unhandled", r?.message || String(r));
  });
}
