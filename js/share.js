// Sends a picture to another app (WhatsApp, Telegram, Gmail...) through the
// phone's share sheet.
//
// Inside the Android app the picture goes to MainActivity over the
// "MyWeatherAndroid" message channel, which only this page's own origin can
// use (not Wunderground or the blog in their frames). MainActivity saves it
// and opens Android's share sheet. In a browser the Web Share API is used if
// it can share files; otherwise the picture is downloaded.

const EXT = { "image/gif": "gif", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "application/json": "json" };

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// A file name like "MyWeather-radar-20261106-1542.gif".
export function shareName(what, type) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  return `MyWeather-${what}-${stamp}.${EXT[type] || "img"}`;
}

/**
 * Shares one picture (or the Settings backup, a JSON file) with a caption. Resolves to "shared", "downloaded" or
 * "cancelled"; throws if nothing could be done.
 */
export async function shareImage({ blob, name, text }) {
  const type = blob.type || "image/png";
  const bridge = window.MyWeatherAndroid;
  if (bridge && typeof bridge.postMessage === "function") {
    const data = await toBase64(blob);
    bridge.postMessage(JSON.stringify({ action: "shareImage", data, type, name, text }));
    return "shared";
  }
  const file = new File([blob], name, { type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text });
      return "shared";
    } catch (e) {
      if (e.name === "AbortError") return "cancelled";
      throw e;
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return "downloaded";
}

/** Wires a Share button: getShare() returns { blob, name, text } or null. */
export function shareButton(button, getShare, say) {
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const item = await getShare();
      if (!item) {
        say?.("Nothing to share yet. Wait for the picture to load.", true);
        return;
      }
      const how = await shareImage(item);
      if (how === "downloaded") say?.("Sharing isn't available here, so the picture was downloaded.");
    } catch (e) {
      say?.(`Couldn't share the picture (${e.message || e}).`, true);
    } finally {
      button.disabled = false;
    }
  });
}
