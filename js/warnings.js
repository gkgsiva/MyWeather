// IMD district-wise nowcast (next 3 hours) and 5-day warnings for Tamil Nadu and
// Puducherry. The same GeoServer feeds IMD's own maps at
//   https://mausam.imd.gov.in/responsive/districtWiseNowcastGIS.php
//   https://mausam.imd.gov.in/responsive/districtWiseWarningGIS.php
// The map is a plain image (WMS GetMap). The district list is read from the WFS
// feed, which allows cross-site reads only inside the Android app (MainActivity
// adds the header); elsewhere just the map shows.
const GEO = "https://reactjs.imd.gov.in/geoserver/imd";
const BBOX = "76.0,7.9,80.6,13.7"; // Tamil Nadu and Puducherry
const STATE = "TAMILNADU"; // IMD's spelling; Puducherry and Karaikal are listed under it
const HOME = "CHENNAI";

// Nowcast categories, from IMD's nowcast page (cat16 holds free text).
const NOWCAST_CATS = {
  2: "Light rain",
  3: "Light snow",
  4: "Light thunderstorm",
  5: "Slight dust storm",
  6: "Low lightning probability",
  7: "Moderate rain",
  8: "Moderate snow",
  9: "Moderate thunderstorm (gusts 41–61 km/h)",
  10: "Moderate dust storm",
  11: "Moderate lightning probability",
  12: "Heavy rain (over 15 mm/h)",
  13: "Heavy snow",
  14: "Severe thunderstorm (gusts 62–87 km/h)",
  15: "Very severe thunderstorm (gusts over 87 km/h)",
  17: "Thunderstorm with hail",
  18: "Severe dust storm",
  19: "High lightning probability",
};

// Day-wise warning codes, from IMD's district warnings page.
const WARNING_CATS = {
  2: "Heavy rain",
  3: "Heavy snow",
  4: "Thunderstorm & lightning",
  5: "Hailstorm",
  6: "Dust storm",
  7: "Dust-raising winds",
  8: "Strong surface winds",
  9: "Heat wave",
  10: "Hot day",
  11: "Warm night",
  12: "Cold wave",
  13: "Cold day",
  14: "Ground frost",
  15: "Fog",
  16: "Very heavy rain",
  17: "Extremely heavy rain",
};

// Levels shared by both lists: 0 none, 1 yellow (watch), 2 orange (alert), 3 red (warning).
const LEVELS = [
  { name: "No warning", color: "#2e7d32" },
  { name: "Yellow · be aware", color: "#f2c200" },
  { name: "Orange · be prepared", color: "#f57c00" },
  { name: "Red · take action", color: "#d32f2f" },
];
// IMD colour codes: nowcast Color 1 green .. 4 red; warnings DayN_Color 4 green .. 1 red.
const nowcastLevel = (c) => (c >= 1 && c <= 4 ? c - 1 : 0);
const warningLevel = (c) => (c >= 1 && c <= 4 ? 4 - c : 0);

const period = document.getElementById("warn-period");
const status = document.getElementById("warn-status");
const list = document.getElementById("warn-list");
const map = document.getElementById("warn-map");
const legend = document.getElementById("warn-legend");
const source = document.getElementById("warn-source");

let data = null; // { nowcast: [...], warnings: Map(name -> props) }
let ready = false;

function wfsUrl(typename, params) {
  const qs = new URLSearchParams({
    service: "WFS",
    version: "1.1.0",
    request: "GetFeature",
    typename,
    outputFormat: "application/json",
    ...params,
  });
  return `${GEO}/ows?${qs}`;
}

function mapUrl(day) {
  const qs = new URLSearchParams({
    service: "WMS",
    version: "1.1.1",
    request: "GetMap",
    layers: day ? "imd:Warnings_StateDistrict_Merged" : "imd:Nowcast_StateDistrict_Merged",
    styles: "",
    srs: "EPSG:4326",
    bbox: BBOX,
    width: "460",
    height: "580",
    format: "image/png",
    t: String(Date.now()),
  });
  if (day) qs.set("env", `day:Day${day}_Color`);
  return `${GEO}/wms?${qs}`;
}

async function getJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const title = (s) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d;
}
const dayLabel = (d) =>
  d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

async function load() {
  const cats = Array.from({ length: 19 }, (_, i) => `cat${i + 1}`);
  const nc = await getJson(
    wfsUrl("imd:NowcastWarningDistrict", {
      CQL_FILTER: `State='${STATE}'`,
      propertyName: ["District", "Date", "toi", "vupto", "Color", "message", ...cats].join(","),
    })
  );
  const nowcast = nc.features.map((f) => f.properties).filter((p) => p.District);
  const names = nowcast.map((p) => `'${p.District.replace(/'/g, "''")}'`).join(",");
  const days = [1, 2, 3, 4, 5];
  const w = await getJson(
    wfsUrl("imd:district_warnings_india", {
      CQL_FILTER: `District IN (${names})`,
      propertyName: [
        "District",
        "Date",
        "updated_at",
        ...days.flatMap((d) => [`Day_${d}`, `Day${d}_Color`, `Day${d}_text`]),
      ].join(","),
    })
  );
  const warnings = new Map(w.features.map((f) => [f.properties.District, f.properties]));
  return { nowcast, warnings };
}

// The issue date most districts share, for the period labels.
function issueDate(warnings) {
  const count = {};
  for (const p of warnings.values()) count[p.Date] = (count[p.Date] || 0) + 1;
  return Object.keys(count).sort((a, b) => count[b] - count[a])[0];
}

function fillPeriods() {
  const keep = period.value || "now";
  const base = data && issueDate(data.warnings);
  const opts = [new Option("Now · next 3 hours", "now")];
  for (let d = 1; d <= 5; d++) {
    const label = base ? dayLabel(addDays(base, d - 1)) : `Day ${d}`;
    opts.push(new Option(`${d === 1 ? "Today" : d === 2 ? "Tomorrow" : `Day ${d}`} · ${label}`, String(d)));
  }
  period.replaceChildren(...opts);
  period.value = keep;
}

function rowsFor(sel) {
  if (sel === "now") {
    return data.nowcast.map((p) => {
      const items = [];
      for (let i = 2; i <= 19; i++) {
        if (i === 16) {
          if (p.cat16) items.push(p.cat16);
        } else if (p[`cat${i}`]) items.push(NOWCAST_CATS[i]);
      }
      if (p.message) items.push(p.message);
      return {
        name: p.District,
        level: nowcastLevel(p.Color),
        text: items.join(" · "),
        when: p.toi && p.vupto ? `${p.toi.padStart(4, "0")}–${p.vupto.padStart(4, "0")} IST` : "",
      };
    });
  }
  const d = Number(sel);
  return data.nowcast.map((n) => {
    const p = data.warnings.get(n.District) || {};
    const codes = String(p[`Day_${d}`] || "")
      .split(",")
      .map(Number)
      .filter((c) => c > 1);
    const items = codes.map((c) => WARNING_CATS[c] || `Code ${c}`);
    if (p[`Day${d}_text`]) items.push(p[`Day${d}_text`]);
    return {
      name: n.District,
      level: warningLevel(p[`Day${d}_Color`]),
      text: items.join(" · "),
      when: p.Date ? `issued ${dayLabel(addDays(p.Date, 0))}` : "",
    };
  });
}

function renderList() {
  if (!data) return;
  const rows = rowsFor(period.value).sort(
    (a, b) =>
      (b.name === HOME) - (a.name === HOME) || b.level - a.level || a.name.localeCompare(b.name)
  );
  list.replaceChildren(
    ...rows.map((r) => {
      const li = document.createElement("li");
      li.className = `level-${r.level}`;
      li.style.setProperty("--level", LEVELS[r.level].color);
      const name = document.createElement("strong");
      name.textContent = title(r.name);
      const text = document.createElement("span");
      text.textContent = r.text || LEVELS[0].name;
      li.append(name, text);
      if (r.when) {
        const when = document.createElement("small");
        when.textContent = r.when;
        li.append(when);
      }
      return li;
    })
  );
}

function renderMap() {
  const sel = period.value;
  map.src = mapUrl(sel === "now" ? 0 : Number(sel));
  map.alt = `IMD ${sel === "now" ? "nowcast" : "warning"} map of Tamil Nadu districts`;
  source.href =
    sel === "now"
      ? "https://mausam.imd.gov.in/responsive/districtWiseNowcastGIS.php"
      : `https://mausam.imd.gov.in/responsive/districtWiseWarningGIS.php?day=${sel}`;
}

async function refresh() {
  renderMap();
  status.textContent = "Loading the district list…";
  status.className = "status";
  try {
    data = await load();
    fillPeriods();
    renderList();
    status.textContent = `Updated ${new Date().toLocaleTimeString()}`;
  } catch {
    list.replaceChildren();
    status.textContent = "Couldn't load the district list from IMD right now. The map may still show.";
    status.className = "status error";
  }
}

function init() {
  fillPeriods();
  legend.replaceChildren(
    ...LEVELS.map((l) => {
      const span = document.createElement("span");
      span.style.setProperty("--level", l.color);
      span.textContent = l.name;
      return span;
    })
  );
  period.addEventListener("change", () => {
    renderMap();
    renderList();
  });
  document.getElementById("warn-refresh").addEventListener("click", refresh);
  map.addEventListener("error", () => {
    if (!data) {
      status.textContent = "Couldn't reach IMD's warning service right now. Try Refresh later.";
      status.className = "status error";
    }
  });
  ready = true;
}

// Reloads each time the Warnings menu is opened.
export function showWarnings() {
  if (!ready) init();
  refresh();
}
