// Helpers for hash routes like #wunderground?id=ICHENN47.
import * as config from "./config.js";

export function routeParams() {
  const q = location.hash.split("?")[1] || "";
  return new URLSearchParams(q);
}

// True inside the Android app, which serves the page from this host and lets
// Wunderground and the blog show in frames.
export const IN_APP = location.hostname === "appassets.androidplatform.net";

// True on the web version served by server.js (Heroku), which tells the page
// it has a proxy by exporting WEB_PROXY from js/config.js. Always false in the
// Android app and in a plain copy of the files.
export const WEB_PROXY = !IN_APP && config.WEB_PROXY === true;

// Whether IMD's pages and data can be read: directly in the app, or through the web server's proxy.
export const CAN_READ_IMD = IN_APP || WEB_PROXY;
