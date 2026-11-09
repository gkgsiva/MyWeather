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

// Every still picture shared from the app carries a mark in its bottom right
// corner: "© gkgsiva" on the app's own pictures; on IMD's radar, satellite,
// lightning and warning pictures (IMD's property) a credit to IMD and a plain
// "gkgsiva". Animated GIFs (IMD's radar and satellite loops) are sent as they
// are, since stamping them would mean re-encoding every frame; their caption
// carries the credit.
export const WATERMARK = "© gkgsiva";
export const IMD_MARK = "gkgsiva";
export const IMD_CREDIT = "Courtesy: India Meteorological Department";
const STAMPABLE = new Set(["image/png", "image/jpeg", "image/webp"]);

async function decode(blob) {
  if (window.createImageBitmap) return createImageBitmap(blob);
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The picture with the watermark; the original when it can't be drawn. */
export async function watermark(blob, { imd = false } = {}) {
  const type = blob.type || "image/png";
  if (!STAMPABLE.has(type)) return blob;
  try {
    const img = await decode(blob);
    const w = img.width;
    const h = img.height;
    if (!w || !h) return blob;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    img.close?.();
    const size = Math.max(11, Math.round(Math.min(w, h * 1.5) * 0.026));
    const pad = Math.round(size * 0.6);
    const family = getComputedStyle(document.body).fontFamily || "sans-serif";
    g.textAlign = "right";
    g.textBaseline = "alphabetic";
    g.lineJoin = "round";
    const x = w - pad;
    // Lines from the bottom up: [text, font size].
    const lines = imd ? [[IMD_MARK, size], [IMD_CREDIT, Math.max(10, Math.round(size * 0.72))]] : [[WATERMARK, size]];
    let y = h - pad;
    for (const [text, px] of lines) {
      g.font = `600 ${px}px ${family}`;
      let fit = px;
      // The credit may be wider than a small picture.
      while (g.measureText(text).width > w - pad * 2 && fit > 8) g.font = `600 ${--fit}px ${family}`;
      // Dark text on a light corner, white on a dark one, with a soft outline.
      const tw = Math.max(1, Math.min(w, Math.ceil(g.measureText(text).width)));
      const data = g.getImageData(Math.max(0, x - tw), Math.max(0, y - fit), tw, Math.max(1, Math.min(h, fit))).data;
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const light = sum / (data.length / 4) > 140;
      g.lineWidth = Math.max(2, fit / 5);
      g.strokeStyle = light ? "rgba(255, 255, 255, 0.7)" : "rgba(0, 0, 0, 0.45)";
      g.strokeText(text, x, y);
      g.fillStyle = light ? "rgba(29, 35, 43, 0.75)" : "rgba(255, 255, 255, 0.9)";
      g.fillText(text, x, y);
      y -= Math.round(fit * 1.25);
    }
    const out = await new Promise((res) => c.toBlob(res, type, 0.92));
    return out || blob;
  } catch {
    return blob;
  }
}

/**
 * Shares one picture (or the Settings backup, a JSON file) with a caption. Resolves to "shared", "downloaded" or
 * "cancelled"; throws if nothing could be done.
 */
export async function shareImage({ blob, name, text, imd = false }) {
  blob = await watermark(blob, { imd });
  if (imd && text && !text.includes(IMD_CREDIT)) text = `${text} ${IMD_CREDIT}.`;
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
