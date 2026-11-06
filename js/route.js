// Helpers for hash routes like #wunderground?id=ICHENN47.
export function routeParams() {
  const q = location.hash.split("?")[1] || "";
  return new URLSearchParams(q);
}

// True inside the Android app, which serves the page from this host and lets
// Wunderground and the blog show in frames.
export const IN_APP = location.hostname === "appassets.androidplatform.net";
