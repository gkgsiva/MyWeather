// The web version (a browser or the iPhone home-screen app, not the Android
// app). The Android app reads IMD and the lake page directly because it adds
// the CORS header itself and shows Wunderground in frames (FrameProxy.java).
// A browser can't, so server.js does the same: this file sends those requests
// to the server's /p/<host>/ copy, and frames to /frame, and registers the
// service worker. Nothing happens in the Android app.
import { WEB_PROXY } from "./route.js";

if (WEB_PROXY) {
  // Sources behind /p/ (server.js PROXY_HOSTS). api.weather.com goes there so
  // the Wunderground key can stay on the server.
  const PROXIED = new Set([
    "mausam.imd.gov.in", "reactjs.imd.gov.in", "cmwssb.tn.gov.in", "chennaimetrowater.tn.gov.in",
    "api.weather.com", "api.waqi.info",
  ]);
  const FRAMED = ["wunderground.com", "kwschennai.com", "cmwssb.tn.gov.in", "chennaimetrowater.tn.gov.in", "airquality.cpcb.gov.in"];

  const viaProxy = (href) => {
    try {
      const u = new URL(href, location.href);
      if (u.protocol === "https:" && PROXIED.has(u.hostname)) return `/p/${u.hostname}${u.pathname}${u.search}`;
    } catch {}
    return null;
  };

  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url;
    const local = href && viaProxy(href);
    if (!local) return realFetch(input, init);
    return realFetch(input instanceof Request ? new Request(local, input) : local, init);
  };

  // Frames: Wunderground, the blog and the like forbid being framed, so they
  // load through /frame (sandboxed). Anything else (Windy) loads as it is.
  const srcProp = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "src");
  Object.defineProperty(HTMLIFrameElement.prototype, "src", {
    ...srcProp,
    set(v) {
      let out = v;
      try {
        const u = new URL(v, location.href);
        if (u.protocol === "https:" && FRAMED.some((d) => u.hostname === d || u.hostname.endsWith("." + d))) {
          out = "/frame?url=" + encodeURIComponent(u.href);
        }
      } catch {}
      srcProp.set.call(this, out);
    },
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
}
