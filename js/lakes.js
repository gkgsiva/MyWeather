// Lakes: storage in Chennai's reservoirs (Poondi, Cholavaram, Puzhal,
// Kannankottai Thervoy Kandigai, Chembarambakkam, Veeranam), read from Chennai
// Metro Water's daily lake-level page. The site sends no CORS header; the
// Android app adds it. If the table can't be read, the page itself is shown
// under the menu (#lakes?page=1). The last table is kept for offline use.
import { routeParams } from "./route.js";
import { when } from "./offline.js";

export const LAKES_PAGE = "https://cmwssb.tn.gov.in/lake-level";
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

// Finds the table that names the reservoirs and returns
// { heading, head: [[cells]], rows: [[cells]] }, or null.
export function parseLakePage(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const table = [...doc.querySelectorAll("table")]
    .filter((t) => LAKE_NAMES.test(t.textContent))
    .sort((a, b) => a.querySelectorAll("tr").length - b.querySelectorAll("tr").length)[0];
  if (!table) return null;
  const head = [];
  const rows = [];
  for (const tr of table.querySelectorAll("tr")) {
    const cells = [...tr.children].map((c) => clean(c.textContent));
    if (!cells.some(Boolean)) continue;
    const isHead = tr.closest("thead") || [...tr.children].every((c) => c.tagName === "TH");
    if (isHead && !rows.length && !LAKE_NAMES.test(cells.join(" "))) head.push(cells);
    else rows.push(cells);
  }
  // A heading or caption near the table usually carries the date.
  let heading = clean(table.querySelector("caption")?.textContent);
  if (!heading) {
    const dateRe = /\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2}\s*(st|nd|rd|th)?\s+[A-Za-z]{3,9},?\s+\d{4}/;
    const tag = [...doc.querySelectorAll("h1,h2,h3,h4,h5,h6,p,strong,b,span,div,td")].find(
      (e) => e.children.length === 0 && dateRe.test(e.textContent) && clean(e.textContent).length < 120
    );
    heading = clean(tag?.textContent);
  }
  return rows.length ? { heading, head, rows } : null;
}

// Percent full for each lake, when the columns can be told apart:
// a "capacity" column and a "storage" (present) column, in the same unit.
function percentFull(data) {
  const labels = data.head.length ? data.head[data.head.length - 1] : [];
  const capCol = labels.findIndex((h) => /capacity/i.test(h));
  const storeCol = labels.findIndex((h, i) => i !== capCol && /storage|present|today/i.test(h));
  if (capCol < 0 || storeCol < 0) return [];
  const offset = (row) => row.length - labels.length; // rows with an extra/missing first cell
  return data.rows
    .filter((r) => LAKE_NAMES.test(r.join(" ")))
    .map((r) => {
      const o = offset(r);
      const cap = num(r[capCol + o]);
      const now = num(r[storeCol + o]);
      const name = r.find((c) => LAKE_NAMES.test(c)) || r[0];
      return { name, cap, now, pct: cap > 0 && now >= 0 ? (100 * now) / cap : NaN };
    })
    .filter((l) => Number.isFinite(l.pct) && l.pct <= 150);
}

function renderTable(data) {
  const table = document.createElement("table");
  table.className = "readings lakes";
  if (data.head.length) {
    const thead = table.createTHead();
    for (const row of data.head) {
      const tr = thead.insertRow();
      for (const c of row) {
        const th = document.createElement("th");
        th.textContent = c;
        tr.append(th);
      }
    }
  }
  const tbody = table.createTBody();
  for (const row of data.rows) {
    const tr = tbody.insertRow();
    row.forEach((c, i) => {
      const cell = document.createElement(i === 0 ? "th" : "td");
      if (i === 0) cell.scope = "row";
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

async function refresh() {
  say("Loading lake levels from Chennai Metro Water…");
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    const res = await fetch(LAKES_PAGE, { signal: ctrl.signal, cache: "no-store" }).finally(() =>
      clearTimeout(timer)
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = parseLakePage(await res.text());
    if (!data) throw Object.assign(new Error("no table"), { format: true });
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
    if (saved?.data) {
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
