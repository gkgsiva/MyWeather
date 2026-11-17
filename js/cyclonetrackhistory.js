// Cyclone watch: "Forecast vs what happened" panel. The arithmetic is in
// cyclonecheck.js; the map is drawn by cyclonetrackmap.js.
import { checkForecast, leadStats, HOUR } from "./cyclonecheck.js";
import { drawTrackMap } from "./cyclonetrackmap.js";

const IST = { timeZone: "Asia/Kolkata" };
const $ = (id) => document.getElementById(id);
let archive = null;
let ready = false;

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k instanceof Node ? k : String(k));
  return e;
}

export const fmt = (ms) => new Date(ms).toLocaleString("en-IN", { ...IST, day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
const fmtIso = (iso) => fmt(Date.parse(iso));
const nm = (s) => s.name || (s.id.startsWith("imd:") ? s.id.slice(4) : s.id.toUpperCase());
export const round5 = (n) => Math.round(n / 5) * 5;
const usable = (s) => s.fc.length > 0 && s.obs.length > 0;

function wire() {
  if (ready) return;
  ready = true;
  $("cw-tr-storm").addEventListener("change", () => fillForecasts());
  $("cw-tr-fc").addEventListener("change", draw);
}

// Called with archive.json (or null) and the id of the storm on screen.
export function showTrackHistory(data, wanted) {
  archive = data;
  const list = Object.values(data?.storms || {})
    .filter(usable)
    .sort((a, b) => b.last.localeCompare(a.last));
  $("cw-p-track").hidden = !list.length;
  if (!list.length) return;
  wire();
  const sel = $("cw-tr-storm");
  const pick = list.find((s) => s.id === wanted) || list.find((s) => s.id === sel.value) || list[0];
  sel.replaceChildren(
    ...list.map((s) => {
      const live = Date.now() - Date.parse(s.last) < 36 * HOUR;
      return el("option", { value: s.id, text: `${nm(s)} · ${s.source.toUpperCase()}${live ? "" : " · ended"}` });
    })
  );
  sel.value = pick.id;
  fillForecasts();
}

function fillForecasts() {
  const s = archive.storms[$("cw-tr-storm").value];
  const fcs = s.fc.slice().reverse();
  const sel = $("cw-tr-fc");
  // Newest first. A forecast with something already to compare is the default.
  const best = fcs.find((f) => checkForecast(s, f).some((p) => p.err != null)) || fcs[0];
  sel.replaceChildren(...fcs.map((f) => el("option", { value: f.issued, text: `Forecast of ${fmtIso(f.issued)}${f.no ? ` (No. ${f.no})` : ""}` })));
  sel.value = best.issued;
  // Shared pictures credit the agency (IMD's are marked shareImd).
  const box = $("cw-p-track");
  if (s.source === "imd") {
    box.dataset.shareImd = "";
    delete box.dataset.shareCredit;
  } else {
    delete box.dataset.shareImd;
    box.dataset.shareCredit = `Courtesy: ${s.agency}`;
  }
  renderStats(s);
  draw();
}

function renderStats(s) {
  const stats = leadStats(s);
  const box = $("cw-tr-stats");
  if (!stats.length) {
    box.replaceChildren(
      el("p", { text: `None of ${nm(s)}'s ${s.fc.length} forecast${s.fc.length === 1 ? "" : "s"} has a point that has come due with a known position yet. This fills in as the storm moves.` })
    );
    return;
  }
  const head = el("tr", {}, ...["Looking ahead", "Checked", "Average error", "Worst"].map((h) => el("th", { text: h })));
  const rows = stats.map((l) =>
    el("tr", {}, el("td", { text: l.label }), el("td", { class: "num", text: `${l.n} point${l.n === 1 ? "" : "s"}` }), el("td", { class: "num", text: `${round5(l.mean)} km` }), el("td", { class: "num", text: `${round5(l.worst)} km` }))
  );
  box.replaceChildren(
    el("p", { class: "cw-verdict", text: `Average error of ${nm(s)}'s forecasts (${s.fc.length} issued):` }),
    el("div", { class: "table-wrap" }, el("table", { class: "cw-table" }, el("thead", {}, head), el("tbody", {}, rows)))
  );
}

function draw() {
  const s = archive.storms[$("cw-tr-storm").value];
  const fc = s.fc.find((f) => f.issued === $("cw-tr-fc").value) || s.fc[s.fc.length - 1];
  const pts = checkForecast(s, fc);
  const head = el("tr", {}, ...["When (IST)", "Ahead", "Forecast", "Where it was", "Error"].map((h) => el("th", { text: h })));
  const rows = pts.map((p) => {
    const w = p.kmh != null && p.obs?.[2] != null ? ` · ${Math.round(p.kmh)} → ${Math.round(p.obs[2])} km/h` : p.kmh != null ? ` · ${Math.round(p.kmh)} km/h` : "";
    return el(
      "tr",
      {},
      el("td", { text: fmt(p.t) }),
      el("td", { class: "num", text: `${Math.round(p.lead)} h` }),
      el("td", { text: `${p.lat.toFixed(1)}, ${p.lon.toFixed(1)}${w}` }),
      el("td", { text: p.obs ? `${p.obs[0].toFixed(1)}, ${p.obs[1].toFixed(1)}` : p.state === "pending" ? "not yet" : "no position" }),
      el("td", { class: "num", text: p.err != null ? `${round5(p.err)} km` : "–" })
    );
  });
  $("cw-tr-table").replaceChildren(el("thead", {}, head), el("tbody", {}, rows));
  const done = pts.filter((p) => p.err != null).length;
  $("cw-tr-foot").textContent =
    `${s.agency}'s forecast issued ${fmtIso(fc.issued)}; ${done} of its ${pts.length} points can be checked so far. ` +
    `"Where it was" is the storm's recorded position at that time (between two recorded positions when none is exact), ` +
    `and the error is the distance between the two. Wind shows forecast → where it was, km/h. Positions are the agency's own, read by the app.`;
  drawTrackMap(s, fc, pts);
}
