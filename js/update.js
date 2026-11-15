// Update notice: asks GitHub for the newest release of MyWeather (at most
// every 12 hours, once the app has started) and, when it is newer than this
// copy, shows a strip under the header with a Download button for its APK.
// The link opens in the phone's browser, which downloads the APK; opening
// the download installs it. "Later" hides the strip until the next release.
//
// Only release builds check (js/version.js holds the version); a development
// copy has no version to compare. Info has a "Check for updates" button.
import { APP_VERSION } from "./version.js";

const API = "https://api.github.com/repos/gkgsiva/MyWeather/releases/latest";
const KEY = "myweather.update"; // { at, latest: { version, apk, page, date }, dismissed }
const EVERY_MS = 12 * 3600e3;

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}
function write(v) {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {}
}

/** -1, 0 or 1, comparing "1.9" and "1.14" as numbers part by part. */
export function compareVersions(a, b) {
  const pa = String(a).replace(/^v/i, "").split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).replace(/^v/i, "").split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** The newest release from GitHub: { version, apk, page, date }. */
export async function fetchLatest() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(API, { headers: { Accept: "application/vnd.github+json" }, signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const r = await res.json();
    const apk = (r.assets || []).find((a) => /\.apk$/i.test(a.name));
    const latest = {
      version: String(r.tag_name || "").replace(/^v/i, ""),
      apk: apk?.browser_download_url || "",
      size: apk?.size || 0,
      page: r.html_url || "https://github.com/gkgsiva/myweather/releases",
      date: r.published_at || "",
    };
    write({ ...read(), at: Date.now(), latest });
    return latest;
  } finally {
    clearTimeout(timer);
  }
}

export const isNewer = (latest, mine = APP_VERSION) => !!(mine && latest?.version && compareVersions(latest.version, mine) > 0);

function strip(latest) {
  document.getElementById("update-bar")?.remove();
  const bar = document.createElement("div");
  bar.id = "update-bar";
  bar.className = "update-bar";
  bar.setAttribute("role", "status");
  const text = document.createElement("p");
  text.innerHTML = "<strong></strong> <span></span>";
  text.querySelector("strong").textContent = `MyWeather v${latest.version} is out.`;
  text.querySelector("span").textContent = `You have v${APP_VERSION}.`;
  const get = document.createElement("a");
  get.className = "button";
  get.href = latest.apk || latest.page;
  get.target = "_blank";
  get.rel = "noopener noreferrer";
  get.textContent = latest.apk ? `Download${latest.size ? ` (${(latest.size / 1048576).toFixed(1)} MB)` : ""}` : "Open release";
  const news = document.createElement("a");
  news.href = "#info";
  news.textContent = "What's new";
  news.className = "update-news";
  news.addEventListener("click", () => bar.remove());
  const later = document.createElement("button");
  later.type = "button";
  later.className = "secondary small";
  later.textContent = "Later";
  later.addEventListener("click", () => {
    write({ ...read(), dismissed: latest.version });
    bar.remove();
  });
  const actions = document.createElement("div");
  actions.className = "update-actions";
  actions.append(get, news, later);
  bar.append(text, actions);
  document.querySelector(".topbar").after(bar);
}

/** Shows the strip if a newer release is known and not put off. */
function maybeShow(latest) {
  const s = read();
  if (isNewer(latest) && s.dismissed !== latest.version) strip(latest);
}

/** Started by js/app.js once the app is up. */
export async function initUpdateCheck() {
  if (!APP_VERSION) return;
  const s = read();
  if (s.latest) maybeShow(s.latest);
  if (s.at && Date.now() - s.at < EVERY_MS) return;
  if (!navigator.onLine) return;
  try {
    maybeShow(await fetchLatest());
  } catch {
    // Tried again next start; the problem log has the details.
  }
}

/** For Info's button: a sentence on the result; shows the strip when newer. */
export async function checkNow() {
  const latest = await fetchLatest();
  if (!APP_VERSION) return `The newest release is v${latest.version}. This is a development copy, so there is nothing to compare.`;
  if (isNewer(latest)) {
    write({ ...read(), dismissed: "" });
    strip(latest);
    return `v${latest.version} is out (you have v${APP_VERSION}). Tap Download at the top.`;
  }
  return `You have the newest version (v${APP_VERSION}).`;
}
