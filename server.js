// MyWeather web server (for Heroku or any Node 20+ host). No dependencies.
//
//  - Serves the app (index.html, css/, js/, icons/) plus the PWA files.
//  - /p/<host>/<path>  Same-origin copy of a data source that sends no CORS
//    header (IMD, Chennai Metro Water), or that needs a secret key which
//    must stay on the server (api.weather.com, api.waqi.info).
//  - /frame?url=...    A page from Wunderground, the Kea blog, Chennai Metro
//    Water or CPCB that forbids framing, shown in the app's frames. It runs
//    in a sandbox with no access to the app's own data.
//
// This does what the Android app's FrameProxy does. Settings are environment
// variables (Heroku config vars): see the README.
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3000;
const WEATHER_API_KEY = process.env.WEATHER_API_KEY || "";
const WAQI_TOKEN = process.env.WAQI_TOKEN || "";
const UA = "MyWeather-web/1 (+https://github.com/gkgsiva/myweather)";
const TIMEOUT_MS = 30000;
const MAX_BYTES = 25 * 1024 * 1024;

// ---- Proxy rules --------------------------------------------------------

// Hosts /p/ may fetch. `only` limits the paths; `key` adds the server's secret
// as a query parameter (replacing any the page sent).
const PROXY_HOSTS = {
  "mausam.imd.gov.in": { only: /^\/(Radar|lightning|Satellite|responsive|chennai)\// },
  "reactjs.imd.gov.in": { only: /^\/geoserver\// },
  "cmwssb.tn.gov.in": {},
  "chennaimetrowater.tn.gov.in": {},
  "api.weather.com": { only: /^\/(v2\/pws|v3\/location\/near)/, key: { param: "apiKey", value: WEATHER_API_KEY } },
  "api.waqi.info": { key: { param: "token", value: WAQI_TOKEN } },
};

// Sites /frame may show.
const FRAME_HOSTS = ["wunderground.com", "kwschennai.com", "cmwssb.tn.gov.in", "chennaimetrowater.tn.gov.in", "airquality.cpcb.gov.in"];
const hostIn = (host, list) => list.some((d) => host === d || host.endsWith("." + d));

// Same as the Android app: ad servers get nothing, leftover ad slots are hidden.
const HIDE_ADS_CSS = "ins.adsbygoogle,[id^='google_ads'],[id^='div-gpt-ad'],[data-google-query-id]," +
  "iframe[src*='doubleclick'],.ad-mrec,.adsbygoogle,[class*='taboola'],ad-slot,.ad-slot-frame,.house-ad," +
  ".house-ad-fallback,.bottom-ads{display:none!important}";

// ---- Static files -------------------------------------------------------

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".gif": "image/gif", ".jpg": "image/jpeg",
};
const COMPRESSIBLE = /^(text\/|application\/(json|manifest|javascript)|image\/svg)/;

// Only the app itself is served, never the repository's other folders.
const STATIC_DIRS = ["css", "js", "icons"];
const STATIC_FILES = ["index.html", "manifest.webmanifest"];

// A fingerprint of the app's files: the service worker's cache name, so a new
// deploy replaces what phones have kept.
function buildId() {
  const h = crypto.createHash("sha1");
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else h.update(p + st.size + st.mtimeMs);
    }
  };
  for (const d of STATIC_DIRS) walk(path.join(ROOT, d));
  for (const f of STATIC_FILES) h.update(fs.readFileSync(path.join(ROOT, f)));
  h.update(WEATHER_API_KEY ? "k" : "-");
  return h.digest("hex").slice(0, 10);
}
const BUILD = process.env.SOURCE_VERSION || buildId();

// js/config.js: the repository's copy has no key. Here it also tells the page
// the proxy exists and, when the server holds the Wunderground key, that one is
// built in (a placeholder: the real key is added by /p/ and never sent out).
function configJs() {
  return `export const WEATHER_API_KEY = ${JSON.stringify(WEATHER_API_KEY ? "held-by-the-server" : "")};\n` +
    "export const WEB_PROXY = true;\n";
}

function serveFile(req, res, body, type, extra = {}) {
  const etag = '"' + crypto.createHash("sha1").update(body).digest("base64url").slice(0, 16) + '"';
  const headers = { "Content-Type": type, ETag: etag, "Cache-Control": "no-cache", ...extra };
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  const wantsGzip = /\bgzip\b/.test(req.headers["accept-encoding"] || "") && COMPRESSIBLE.test(type) && body.length > 1024;
  headers.Vary = "Accept-Encoding";
  if (wantsGzip) {
    headers["Content-Encoding"] = "gzip";
    body = zlib.gzipSync(body);
  }
  res.writeHead(200, headers);
  res.end(req.method === "HEAD" ? undefined : body);
}

function serveStatic(req, res, pathname) {
  if (pathname === "/") pathname = "/index.html";
  if (pathname === "/js/config.js") return serveFile(req, res, Buffer.from(configJs()), TYPES[".js"]);
  if (pathname === "/sw.js") {
    const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8").replace("__BUILD__", BUILD);
    return serveFile(req, res, Buffer.from(sw), TYPES[".js"], { "Service-Worker-Allowed": "/" });
  }
  const first = pathname.split("/")[1];
  const ok = STATIC_FILES.includes(first) || STATIC_DIRS.includes(first);
  const file = path.normalize(path.join(ROOT, pathname));
  if (!ok || !file.startsWith(ROOT + path.sep) || pathname.includes("\0")) return notFound(res);
  fs.readFile(file, (err, body) => {
    if (err) return notFound(res);
    serveFile(req, res, body, TYPES[path.extname(file)] || "application/octet-stream");
  });
}

function notFound(res) {
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
}

// ---- Rate limit (one visitor can't use up the keys) ---------------------

const hits = new Map();
function limited(req) {
  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress).split(",").pop().trim();
  const minute = Math.floor(Date.now() / 60000);
  const h = hits.get(ip);
  if (!h || h.minute !== minute) {
    hits.set(ip, { minute, n: 1 });
    if (hits.size > 5000) for (const [k, v] of hits) if (v.minute !== minute) hits.delete(k);
    return false;
  }
  return ++h.n > 240;
}

// ---- Fetching from upstream --------------------------------------------

async function upstream(url, req) {
  const headers = { "User-Agent": UA, Accept: req.headers.accept || "*/*" };
  if (req.headers["if-modified-since"]) headers["If-Modified-Since"] = req.headers["if-modified-since"];
  const r = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
  const len = Number(r.headers.get("content-length"));
  if (len > MAX_BYTES) throw new Error("too large");
  const body = Buffer.from(await r.arrayBuffer());
  if (body.length > MAX_BYTES) throw new Error("too large");
  return { r, body };
}

function fail(res, e) {
  res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" });
  res.end("Couldn't reach the source: " + (e && e.name === "TimeoutError" ? "timed out" : "failed"));
}

async function handleProxy(req, res, pathname, search) {
  const m = /^\/p\/([a-z0-9.-]+)(\/.*)?$/i.exec(pathname);
  const host = m && m[1].toLowerCase();
  const rule = host && Object.hasOwn(PROXY_HOSTS, host) ? PROXY_HOSTS[host] : null;
  const rest = (m && m[2]) || "/";
  if (!rule || (rule.only && !rule.only.test(rest)) || rest.includes("..")) return notFound(res);
  if (limited(req)) {
    res.writeHead(429, { "Content-Type": "text/plain" });
    return res.end("Too many requests");
  }
  const url = new URL("https://" + host + rest + search);
  if (rule.key && rule.key.value) url.searchParams.set(rule.key.param, rule.key.value);
  try {
    const { r, body } = await upstream(url, req);
    if (!hostIn(new URL(r.url).hostname, [host])) throw new Error("redirected elsewhere");
    const headers = {
      "Content-Type": r.headers.get("content-type") || "application/octet-stream",
      "Cache-Control": r.ok ? "public, max-age=60" : "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": "last-modified, date",
    };
    for (const h of ["last-modified", "date", "etag"]) if (r.headers.get(h)) headers[h] = r.headers.get(h);
    res.writeHead(r.status === 304 ? 304 : r.status, headers);
    res.end(req.method === "HEAD" ? undefined : body);
  } catch (e) {
    fail(res, e);
  }
}

// Touches at the top of a framed page go to the app, for pull to refresh
// (js/pull.js); links stay inside the frame, or open a new tab off the list.
const frameScript = (proxy) => "<script>(function(){var P=" + JSON.stringify(proxy) + ",H=" + JSON.stringify(FRAME_HOSTS) + ";" +
  "function ok(h){return H.some(function(d){return h===d||h.slice(-d.length-1)==='.'+d;});}" +
  "addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[href]');" +
  "if(!a||e.defaultPrevented||e.metaKey||e.ctrlKey)return;var u;try{u=new URL(a.href);}catch(x){return;}" +
  "if(u.protocol!=='https:'&&u.protocol!=='http:')return;e.preventDefault();" +
  "if(ok(u.hostname))location.href=P+encodeURIComponent(u.href);else window.open(u.href,'_blank','noopener');},true);" +
  "if(window.parent===window)return;var on=false;function s(p,y){window.parent.postMessage({myweather:'pull',phase:p,y:y,href:location.href},'*');}" +
  "addEventListener('touchstart',function(e){on=e.touches.length===1&&window.scrollY<=0;if(on)s('start',e.touches[0].clientY);},{passive:true});" +
  "addEventListener('touchmove',function(e){if(on)s('move',e.touches[0].clientY);},{passive:true});" +
  "addEventListener('touchend',function(){if(on){on=false;s('end',0);}},{passive:true});" +
  "addEventListener('touchcancel',function(){if(on){on=false;s('cancel',0);}},{passive:true});})();</script>";

async function handleFrame(req, res, search, origin) {
  let target;
  try {
    target = new URL(new URLSearchParams(search).get("url"));
  } catch {
    return notFound(res);
  }
  if (target.protocol !== "https:" || !hostIn(target.hostname, FRAME_HOSTS)) return notFound(res);
  if (limited(req)) {
    res.writeHead(429, { "Content-Type": "text/plain" });
    return res.end("Too many requests");
  }
  try {
    const { r, body } = await upstream(target, req);
    const final = new URL(r.url);
    if (!hostIn(final.hostname, FRAME_HOSTS)) throw new Error("redirected elsewhere");
    const type = r.headers.get("content-type") || "application/octet-stream";
    // Sandboxed without allow-same-origin: the framed site's scripts get an
    // empty origin and can't read the app's saved places, keys or settings.
    const headers = {
      "Content-Security-Policy": "sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox",
      "Cache-Control": "no-store",
    };
    let out = body;
    if (/^text\/html/i.test(type)) {
      const cs = /charset=["']?([\w-]+)/i.exec(type);
      let html;
      try {
        html = new TextDecoder(cs ? cs[1] : "utf-8").decode(body);
      } catch {
        html = body.toString("utf8");
      }
      const inject = `<base href="${final.href.replace(/"/g, "%22")}" target="_self"><style id="myweather-noads">${HIDE_ADS_CSS}</style>` +
        frameScript(origin + "/frame?url=");
      const head = /<head[^>]*>/i.exec(html);
      html = head ? html.slice(0, head.index + head[0].length) + inject + html.slice(head.index + head[0].length) : inject + html;
      out = Buffer.from(html, "utf8");
      headers["Content-Type"] = "text/html; charset=utf-8";
    } else {
      headers["Content-Type"] = type;
    }
    res.writeHead(r.status, headers);
    res.end(out);
  } catch (e) {
    fail(res, e);
  }
}

// ---- Server -------------------------------------------------------------

const server = http.createServer((req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    return res.end();
  }
  const proto = String(req.headers["x-forwarded-proto"] || "http").split(",")[0];
  const origin = `${proto}://${req.headers.host}`;
  const u = new URL(req.url, origin);
  let pathname;
  try {
    pathname = decodeURIComponent(u.pathname);
  } catch {
    return notFound(res);
  }
  if (pathname === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    return res.end("ok");
  }
  if (pathname.startsWith("/p/")) return void handleProxy(req, res, u.pathname, u.search);
  if (pathname === "/frame") return void handleFrame(req, res, u.search, origin);
  // Heroku's router sends http and https; ask phones to use https for the home-screen app.
  if (proto === "http" && !/^(localhost|127\.|\[::1\])/.test(req.headers.host || "")) {
    res.writeHead(301, { Location: "https://" + req.headers.host + req.url });
    return res.end();
  }
  serveStatic(req, res, pathname);
});

server.listen(PORT, () => console.log(`MyWeather web on :${PORT} (build ${BUILD})`));
