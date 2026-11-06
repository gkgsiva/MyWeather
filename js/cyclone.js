// Cyclones: IMD's current cyclone bulletins (PDFs, which open in the phone's
// browser or PDF viewer) and the track, wind and storm-surge maps, read from
// IMD's Cyclone Information page. The page has no CORS header; the Android app
// adds it. The last list is kept on the phone for when the network drops.
import { when } from "./offline.js";

const PAGE = "https://mausam.imd.gov.in/responsive/cycloneinformation.php";
const SAVED_KEY = "myweather.cyclone.last";

const $ = (id) => document.getElementById(id);
const status = $("cyc-status");
const maps = $("cyc-maps");
const bulletins = $("cyc-bulletins");

let loadedAt = 0;

function say(text, error = false) {
  status.textContent = text;
  status.className = error ? "status error" : "status";
}

// The page lists its items as openPDF("Title", "url") / openImage("Title", "url").
export function parseCyclonePage(html) {
  const items = [];
  const seen = new Set();
  const re = /open(PDF|Image)\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)/g;
  let m;
  while ((m = re.exec(html))) {
    const [, kind, title, url] = m;
    if (seen.has(title)) continue;
    seen.add(title);
    items.push({ kind: kind === "PDF" ? "pdf" : "image", title, url: new URL(url, PAGE).href });
  }
  return items;
}

// "29__National_Bulletin_No_29-04Nov2026_1130IST.pdf" → "National Bulletin No 29-04Nov2026 1130IST"
function fileLabel(url) {
  const name = decodeURIComponent(url.split("/").pop() || "").replace(/\.pdf$/i, "");
  return name.replace(/^\d+_+/, "").replace(/_+/g, " ").trim();
}

function render(items) {
  maps.replaceChildren(
    ...items
      .filter((i) => i.kind === "image")
      .map((i) => {
        const fig = document.createElement("figure");
        const img = document.createElement("img");
        img.src = i.url;
        img.alt = i.title;
        img.loading = "lazy";
        const cap = document.createElement("figcaption");
        const a = document.createElement("a");
        a.href = i.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = i.title;
        cap.append(a);
        img.addEventListener("error", () => {
          cap.textContent = `${i.title}: not available right now.`;
        });
        fig.append(img, cap);
        return fig;
      })
  );
  bulletins.replaceChildren(
    ...items
      .filter((i) => i.kind === "pdf")
      .map((i) => {
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = i.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = i.title;
        const small = document.createElement("small");
        small.textContent = `PDF · ${fileLabel(i.url)}`;
        li.append(a, small);
        return li;
      })
  );
}

async function refresh() {
  say("Loading IMD's cyclone page…");
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    const res = await fetch(PAGE, { signal: ctrl.signal, cache: "no-store" }).finally(() =>
      clearTimeout(timer)
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const items = parseCyclonePage(await res.text());
    if (!items.length) throw new Error("IMD's page has changed");
    render(items);
    loadedAt = Date.now();
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify({ at: loadedAt, items }));
    } catch {}
    say(`Updated ${new Date().toLocaleTimeString()}`);
  } catch (e) {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(SAVED_KEY));
    } catch {}
    if (saved?.items?.length) {
      render(saved.items);
      say(`Couldn't reach IMD. Showing the list saved at ${when(saved.at)}.`, true);
    } else {
      say("Couldn't load IMD's cyclone page. Open it from the link below.", true);
    }
  }
}

export function initCyclone() {
  $("cyc-refresh").addEventListener("click", refresh);
}

// Reloads when the screen is opened again after a few minutes.
export function showCyclone() {
  if (Date.now() - loadedAt > 5 * 60 * 1000) refresh();
}
