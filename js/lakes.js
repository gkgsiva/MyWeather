// Lakes: storage in Chennai's reservoirs (Poondi, Cholavaram, Puzhal,
// Kannankottai Thervoy Kandigai, Chembarambakkam, Veeranam), read from Chennai
// Metro Water's daily lake-level page. The site sends no CORS header; the
// Android app adds it. If the table can't be read, the page itself is shown
// under the menu (#lakes?page=1). The last table is kept for offline use.
import { routeParams } from "./route.js";
import { when } from "./offline.js";

// The page Siva's phone shows; the older address is tried if it fails.
export const LAKES_PAGE = "https://cmwssb.tn.gov.in/lakelevel";
const LAKES_PAGE_OLD = "https://cmwssb.tn.gov.in/lake-level";
const SAVED_KEY = "myweather.lakes.last";
const LAKE_NAMES = /poondi|cholavaram|puzhal|redhills|red hills|chembarambakkam|kannankottai|thervoy|veeranam/i;

const $ = (id) => document.getElementById(id);
const status = $("lake-status");
const summary = $("lake-summary");
const tableWrap = $("lake-table");
const home = $("lake-home");
const frame = $("lake-frame");
const reader = $("lake-reader");

let loadedAt = 0;

function say(text, error = false) {
  status.textContent = text;
  status.className = error ? "status error" : "status";
}

const clean = (t) => (t || "").replace(/\s+/g, " ").trim();
const num = (t) => {
  const m = clean(t).replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : NaN;
};

// A table as a grid of cell texts, with rowspan/colspan cells repeated in
// every row and column they cover.
function tableGrid(table) {
  const grid = [];
  [...table.querySelectorAll("tr")].forEach((tr, r) => {
    grid[r] ||= [];
    let c = 0;
    for (const cell of tr.children) {
      while (grid[r][c] !== undefined) c++;
      const text = clean(cell.textContent);
      const rs = Math.min(50, Math.max(1, cell.rowSpan || 1));
      const cs = Math.min(50, Math.max(1, cell.colSpan || 1));
      for (let i = 0; i < rs; i++) {
        grid[r + i] ||= [];
        for (let j = 0; j < cs; j++) grid[r + i][c + j] = text;
      }
      c += cs;
    }
  });
  const width = Math.max(0, ...grid.map((row) => row.length));
  return grid
    .map((row) => Array.from({ length: width }, (_, i) => row[i] ?? ""))
    .filter((row) => row.some(Boolean));
}

const lakeCells = (cells) => cells.filter((c) => LAKE_NAMES.test(c)).length;

// Finds the table that names the reservoirs and returns
// { heading, labels: [column labels], rows: [[cells]] }, one row per lake
// (plus any total row), or null. Works whether the lakes are rows or columns.
export function parseLakePage(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const table = [...doc.querySelectorAll("table")]
    .filter((t) => LAKE_NAMES.test(t.textContent))
    .sort((a, b) => a.querySelectorAll("tr").length - b.querySelectorAll("tr").length)[0];
  if (!table) return null;
  let grid = tableGrid(table);
  // Lakes across the top (several names in one row): turn it so lakes are rows.
  if (grid.some((row) => lakeCells(row) >= 3)) {
    grid = grid[0].map((_, c) => grid.map((row) => row[c]));
  }
  const first = grid.findIndex((row) => lakeCells(row) > 0);
  if (first < 0) return null;
  const width = grid[0].length;
  // Column labels: the header rows above the first lake, joined per column.
  const labels = Array.from({ length: width }, (_, c) => {
    const parts = [];
    for (const row of grid.slice(0, first)) if (row[c] && !parts.includes(row[c])) parts.push(row[c]);
    return parts.join(" · ");
  });
  const rows = grid.slice(first).filter((row) => lakeCells(row) > 0 || /total/i.test(row.join(" ")));
  // Drop columns empty in every row (image-only cells, spacers).
  const keep = labels.map((l, c) => l || rows.some((r) => r[c]));
  const pick = (row) => row.filter((_, c) => keep[c]);

  // A heading near the table usually carries the date ("Lake Storage As On - 06/11/2026").
  let heading = clean(table.querySelector("caption")?.textContent);
  if (!heading) {
    const dateRe = /\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2}\s*(st|nd|rd|th)?\s+[A-Za-z]{3,9},?\s+\d{4}/;
    const tag = [...doc.querySelectorAll("h1,h2,h3,h4,h5,h6,p,strong,b,span,div,td")].find(
      (e) =>
        !e.closest("form") &&
        e.children.length === 0 &&
        dateRe.test(e.textContent) &&
        clean(e.textContent).length < 120
    );
    heading = clean(tag?.textContent);
  }
  return rows.length ? { heading, labels: pick(labels), rows: rows.map(pick) } : null;
}

// Percent full for each lake, when the columns can be told apart: a
// "capacity" column and today's "storage" column (same unit, mcft).
function percentFull(data) {
  const L = data.labels;
  const capCol = L.findIndex((h) => /capacity/i.test(h));
  const isStore = (h) => /storage/i.test(h) && !/capacity|last|year|previous/i.test(h);
  let storeCol = L.findIndex((h) => isStore(h) && /today|present|current|as on/i.test(h));
  if (storeCol < 0) storeCol = L.findIndex(isStore);
  if (capCol < 0 || storeCol < 0) return [];
  return data.rows
    .filter((r) => lakeCells(r) > 0)
    .map((r) => {
      const cap = num(r[capCol]);
      const now = num(r[storeCol]);
      // "CHEMBARAMBAKKAM" → "Chembarambakkam"
      const name = r.find((c) => LAKE_NAMES.test(c)).toLowerCase().replace(/\b\w/g, (ch) => ch.toUpperCase());
      return { name, pct: cap > 0 && now >= 0 ? (100 * now) / cap : NaN };
    })
    .filter((l) => Number.isFinite(l.pct) && l.pct <= 150);
}

function renderTable(data) {
  const table = document.createElement("table");
  table.className = "readings lakes";
  if (data.labels.some(Boolean)) {
    const tr = table.createTHead().insertRow();
    for (const c of data.labels) {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = c;
      tr.append(th);
    }
  }
  const tbody = table.createTBody();
  for (const row of data.rows) {
    const tr = tbody.insertRow();
    let nameCol = row.findIndex((c) => LAKE_NAMES.test(c) || /total/i.test(c));
    if (nameCol < 0) nameCol = 0;
    row.forEach((c, i) => {
      const cell = document.createElement(i === nameCol ? "th" : "td");
      if (i === nameCol) cell.scope = "row";
      cell.textContent = c;
      tr.append(cell);
    });
  }
  tableWrap.replaceChildren(table);

  const lakes = percentFull(data);
  summary.replaceChildren(
    ...lakes.map((l) => {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = l.name;
      const bar = document.createElement("span");
      bar.className = "meter";
      const fill = document.createElement("span");
      fill.style.width = `${Math.min(100, l.pct)}%`;
      bar.append(fill);
      const val = document.createElement("b");
      val.textContent = `${Math.round(l.pct)}%`;
      li.append(name, bar, val);
      return li;
    })
  );
  summary.hidden = !lakes.length;
  $("lake-heading").textContent = data.heading || "";
}

async function fetchLakes(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseLakePage(await res.text());
  } finally {
    clearTimeout(timer);
  }
}

async function refresh() {
  say("Loading lake levels from Chennai Metro Water…");
  try {
    let data = null;
    let lastError = null;
    for (const url of [LAKES_PAGE, LAKES_PAGE_OLD]) {
      try {
        data = await fetchLakes(url);
        if (data) break;
        lastError = Object.assign(new Error("no table"), { format: true });
      } catch (e) {
        lastError = e;
      }
    }
    if (!data) throw lastError;
    renderTable(data);
    loadedAt = Date.now();
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify({ at: loadedAt, data }));
    } catch {}
    say(`Updated ${new Date().toLocaleTimeString()}`);
  } catch (e) {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(SAVED_KEY));
    } catch {}
    if (saved?.data?.labels) {
      renderTable(saved.data);
      say(`Couldn't read the lake levels just now. Showing the table saved at ${when(saved.at)}.`, true);
    } else {
      tableWrap.replaceChildren();
      summary.hidden = true;
      say(
        e.format
          ? "Couldn't find the lake table on Metro Water's page. Open the page below."
          : "Couldn't reach Chennai Metro Water. Try Refresh, or open the page below.",
        true
      );
    }
  }
}

function render() {
  const page = routeParams().get("page") === "1";
  home.hidden = page;
  reader.hidden = !page;
  if (page) {
    if (!frame.src) frame.src = LAKES_PAGE;
    return;
  }
  if (Date.now() - loadedAt > 10 * 60 * 1000) refresh();
}

export function initLakes() {
  $("lake-refresh").addEventListener("click", refresh);
}

export function showLakes() {
  render();
}
