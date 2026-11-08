// Checks that every data source the app reads still answers with what the app
// expects. Run daily by .github/workflows/data-sources.yml (and by hand with
// `node scripts/check-sources.mjs`). Writes a Markdown report to
// $REPORT (default data-sources-report.md) and exits 1 if any check failed.
//
// Each check fetches one URL and tests the answer: status 200, the content
// type, a minimum size, and for pages and JSON something the app's parser
// relies on. A source that is down for a few minutes is retried once.
// WEATHER_API_KEY (repo secret) lets the Wunderground check run; without it
// that check is skipped.
import { writeFileSync } from "node:fs";

const UA = "MyWeather data-source check (github.com/gkgsiva/myweather)";
const TIMEOUT = 45_000;

// Rain days on TN-SMART run 08:30 to 08:30 IST, named after the day they end.
function istDay(offsetDays = 0) {
  const d = new Date(Date.now() + 5.5 * 3600e3 - 8.5 * 3600e3 + 24 * 3600e3 + offsetDays * 24 * 3600e3);
  return d.toISOString().slice(0, 10);
}

const isImage = (type) => (r) => r.type.startsWith(type) || `wanted ${type}, got ${r.type || "no content type"}`;
const minBytes = (n) => (r) => r.bytes >= n || `only ${r.bytes} bytes`;
const has = (re, what) => (r) => re.test(r.text) || `no ${what} in the page`;
const json = (test, what) => (r) => {
  let data;
  try {
    data = JSON.parse(r.text);
  } catch {
    return "not JSON";
  }
  return test(data) || what;
};

const IMD = "https://mausam.imd.gov.in";
const GEO = "https://reactjs.imd.gov.in/geoserver/imd";
const TNS = "https://beta-tnsmart.rimes.int";

const CHECKS = [
  // IMD radar, satellite, lightning (Radars, Radar map, TN mosaic, Satellite, Lightning)
  { group: "IMD", name: "Chennai radar picture", url: `${IMD}/Radar/caz_cni.gif`, tests: [isImage("image/"), minBytes(5000)] },
  { group: "IMD", name: "Chennai radar loop", url: `${IMD}/Radar/animation/Converted/CNI_MAXZ.gif`, tests: [isImage("image/gif"), minBytes(50_000)] },
  { group: "IMD", name: "Karaikal radar loop", url: `${IMD}/Radar/animation/Converted/KKL_MAXZ.gif`, tests: [isImage("image/gif"), minBytes(50_000)] },
  { group: "IMD", name: "Satellite picture", url: `${IMD}/Satellite/3Dasiasec_ir1.jpg`, tests: [isImage("image/"), minBytes(20_000)] },
  { group: "IMD", name: "Lightning map", url: `${IMD}/lightning/Converted/BT.gif`, tests: [isImage("image/gif"), minBytes(10_000)] },
  // IMD pages and map server (Warnings, Monsoon, Cyclones, gauge normals, cyclone track)
  { group: "IMD", name: "District rainfall page", url: `${IMD}/responsive/rainfallinformation.php?msg=W`, tests: [minBytes(5000), has(/CHENNAI/i, "Chennai row")] },
  { group: "IMD", name: "Cyclone page", url: `${IMD}/responsive/cycloneinformation.php`, tests: [minBytes(2000)] },
  {
    group: "IMD",
    name: "Nowcast warnings (map server)",
    url: `${GEO}/ows?service=WFS&version=1.1.0&request=GetFeature&typename=imd:NowcastWarningDistrict&outputFormat=application/json&CQL_FILTER=State%3D%27TAMILNADU%27&propertyName=District`,
    tests: [json((d) => Array.isArray(d.features) && d.features.length > 0, "no Tamil Nadu districts")],
  },
  {
    group: "IMD",
    name: "Cyclone track (map server)",
    url: `${GEO}/wfs?service=WFS&version=1.0.0&request=GetFeature&typeName=imd:Cyclone_Track_V&outputFormat=application/json&srsName=EPSG:4326`,
    tests: [json((d) => Array.isArray(d.features), "no feature list")],
  },
  // TN-SMART (TN rain gauges, Rain map, Rain spell, Records, Station health)
  {
    group: "TN-SMART",
    name: "Hourly rain gauges (today or yesterday)",
    url: [`${TNS}/Rainfall_Python_IDW/Hourly_json/hourly_rainfall_${istDay()}.json`, `${TNS}/Rainfall_Python_IDW/Hourly_json/hourly_rainfall_${istDay(-1)}.json`],
    tests: [json((d) => (Array.isArray(d) ? d.length : Object.keys(d || {}).length) > 50, "fewer than 50 gauges")],
  },
  {
    group: "TN-SMART",
    name: "District daily means (yesterday)",
    url: [`${TNS}/Rainfall_Python_IDW/srg_arg/mean_rainfall_district_${istDay(-1)}.json`, `${TNS}/Rainfall_Python_IDW/srg_arg/mean_rainfall_district_${istDay(-2)}.json`],
    tests: [json((d) => d && typeof d === "object", "empty")],
  },
  { group: "TN-SMART", name: "District outlines", url: `${TNS}/DATA/countries/IND/district_tn.geojson`, tests: [json((d) => d.features?.length >= 30, "fewer than 30 districts")] },
  // Lakes
  { group: "Lakes", name: "Chennai Metro Water lake levels", url: "https://cmwssb.tn.gov.in/lakelevel", tests: [minBytes(5000), has(/chembarambakkam/i, "Chembarambakkam row")] },
  // Wunderground (station strip, Wunderground, Station map, Rain history)
  {
    group: "Wunderground",
    name: "Station reading (Nungambakkam-KWS)",
    needs: "WEATHER_API_KEY",
    url: () =>
      `https://api.weather.com/v2/pws/observations/current?stationId=ICHENNAI1&format=json&units=m&numericPrecision=decimal&apiKey=${process.env.WEATHER_API_KEY}`,
    hideUrl: "https://api.weather.com/v2/pws/observations/current?stationId=ICHENNAI1 (key hidden)",
    // 204 = the station is offline, which still shows the key and API work.
    ok: [200, 204],
    tests: [(r) => r.status === 204 || /"observations"/.test(r.text) || "no observations"],
  },
  // Open-Meteo (Forecast, Heat, Wind, Air quality, Sea, Year on year)
  {
    group: "Open-Meteo",
    name: "Forecast",
    url: "https://api.open-meteo.com/v1/forecast?latitude=13.08&longitude=80.27&current=temperature_2m&hourly=precipitation_probability&forecast_days=1",
    tests: [json((d) => typeof d.current?.temperature_2m === "number", "no temperature")],
  },
  {
    group: "Open-Meteo",
    name: "Air quality",
    url: "https://air-quality-api.open-meteo.com/v1/air-quality?latitude=13.08&longitude=80.27&hourly=pm2_5&forecast_days=1",
    tests: [json((d) => Array.isArray(d.hourly?.pm2_5), "no PM2.5")],
  },
  {
    group: "Open-Meteo",
    name: "Sea",
    url: "https://marine-api.open-meteo.com/v1/marine?latitude=13.05&longitude=80.3&hourly=wave_height&forecast_days=1",
    tests: [json((d) => Array.isArray(d.hourly?.wave_height), "no wave height")],
  },
  // Blog
  { group: "Kea Blog", name: "Latest posts", url: "https://kwschennai.com/blog/wp-json/wp/v2/posts?per_page=1&_fields=link", tests: [json((d) => Array.isArray(d) && d.length > 0, "no posts")] },
];

async function get(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  const start = Date.now();
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: ctrl.signal, redirect: "follow" });
    const buf = Buffer.from(await res.arrayBuffer());
    const type = (res.headers.get("content-type") || "").toLowerCase();
    const text = /image|octet/.test(type) ? "" : buf.toString("utf8");
    return { status: res.status, type, bytes: buf.length, text, ms: Date.now() - start };
  } finally {
    clearTimeout(timer);
  }
}

async function runOne(check) {
  if (check.needs && !process.env[check.needs]) return { ...check, state: "skipped", why: `${check.needs} secret not set` };
  const urls = [].concat(typeof check.url === "function" ? check.url() : check.url);
  let last = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const url of urls) {
      try {
        const r = await get(url);
        const okStatus = (check.ok || [200]).includes(r.status);
        const fail = !okStatus ? `HTTP ${r.status}` : check.tests.map((t) => t(r)).find((x) => x !== true);
        if (!fail) return { ...check, state: "ok", ms: r.ms, bytes: r.bytes, used: url };
        last = { why: fail, used: url };
      } catch (e) {
        last = { why: e.name === "AbortError" ? `no answer in ${TIMEOUT / 1000} s` : e.cause?.code || e.message, used: url };
      }
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 20_000));
  }
  return { ...check, state: "failed", ...last };
}

const results = [];
for (const c of CHECKS) {
  const r = await runOne(c);
  results.push(r);
  const tag = r.state === "ok" ? "ok  " : r.state === "skipped" ? "skip" : "FAIL";
  console.log(`${tag} ${r.group} · ${r.name}${r.state === "ok" ? ` (${r.ms} ms)` : ` — ${r.why}`}`);
}

const failed = results.filter((r) => r.state === "failed");
const icon = { ok: "✅", failed: "❌", skipped: "⏭️" };
const shown = (r) => r.hideUrl || [].concat(r.used || r.url)[0];
const lines = [
  failed.length ? `**${failed.length} of ${results.length} data sources failed** on ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC.` : `All ${results.length} data sources answered.`,
  "",
  "| | Source | Check | Result |",
  "|---|---|---|---|",
  ...results.map((r) => `| ${icon[r.state]} | ${r.group} | ${r.name} | ${r.state === "ok" ? `${r.ms} ms, ${Math.round(r.bytes / 1024)} KB` : r.why} |`),
];
if (failed.length) {
  lines.push("", "Failed URLs:", "", ...failed.map((r) => `- ${r.name}: ${shown(r)}`));
  lines.push("", "A source that is down for a while usually comes back by itself. If one keeps failing for days, its address or format has probably changed and the app's code for it needs updating.");
}
writeFileSync(process.env.REPORT || "data-sources-report.md", lines.join("\n") + "\n");
process.exitCode = failed.length ? 1 : 0;
