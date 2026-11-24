// Sends a picture to another app (WhatsApp, Telegram, Gmail...) through the
// phone's share sheet.
//
// Inside the Android app the picture goes to MainActivity over the
// "MyWeatherAndroid" message channel, which only this page's own origin can
// use (not Wunderground or the blog in their frames). MainActivity saves it
// and opens Android's share sheet. In a browser the Web Share API is used if
// it can share files; otherwise the picture is downloaded.

const EXT = { "image/gif": "gif", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "application/json": "json", "text/plain": "txt" };

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

// Every still picture shared from the app carries a mark in a corner (bottom
// right unless changed in Settings): "© <name>" on the app's own pictures; on
// IMD's radar, satellite, lightning and warning pictures (IMD's property) a
// credit to IMD and a plain "<name>", never ©. The name is set in Settings
// (js/prefs.js watermarkName(), "gkgsiva" by default); when it is cleared the
// app's own pictures get no mark and IMD's keep only the credit. The corner,
// size and strength come from prefs.js shareLook(). Animated GIFs (IMD's
// radar and satellite loops) are sent as they are, since stamping them would
// mean re-encoding every frame; their caption carries the credit.
import { watermarkName, shareLook } from "./prefs.js";

/** The lines drawn on a picture, from the bottom up: [[text, size factor]]. */
// `imd` is true for IMD's pictures, or another agency's credit line ("Courtesy:
// NOAA National Hurricane Center") for theirs; the rule is the same.
export function watermarkLines({ imd = false, name = watermarkName() } = {}) {
  const credit = creditOf(imd);
  if (credit) return name ? [[name, 1], [credit, 0.72]] : [[credit, 0.72]];
  return name ? [[`© ${name}`, 1]] : [];
}
const SIZE = { s: 0.75, m: 1, l: 1.35 };
// [outline alpha on a light / dark corner, text alpha on a light / dark corner]
const STRENGTH = {
  light: [[0.45, 0.25], [0.45, 0.55]],
  normal: [[0.7, 0.45], [0.75, 0.9]],
  strong: [[0.85, 0.6], [0.95, 1]],
};
export const IMD_CREDIT = "Courtesy: India Meteorological Department";
const creditOf = (imd) => (typeof imd === "string" && imd ? imd : imd ? IMD_CREDIT : null);
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

/**
 * The picture with the watermark; the original when it can't be drawn. look
 * overrides Settings (shareLook()) and name the Settings name, for a preview.
 * insetTop keeps a top-corner mark below a band (js/snap.js sets blob.markTop).
 */
export async function watermark(blob, { imd = false, look = shareLook(), name = watermarkName(), insetTop = blob.markTop || 0 } = {}) {
  const type = blob.type || "image/png";
  if (!STAMPABLE.has(type)) return blob;
  try {
    const img = await decode(blob);
    const w = img.width;
    const h = img.height;
    if (!w || !h) return blob;
    const marks = watermarkLines({ imd, name });
    if (!marks.length) return blob;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    img.close?.();
    const size = Math.max(9, Math.round(Math.min(w, h * 1.5) * 0.026 * (SIZE[look.size] || 1)));
    const pad = Math.round(size * 0.6);
    const family = getComputedStyle(document.body).fontFamily || "sans-serif";
    const right = look.corner[1] !== "l";
    const top = look.corner[0] === "t";
    const [[strokeLight, strokeDark], [fillLight, fillDark]] = STRENGTH[look.strength] || STRENGTH.normal;
    g.textAlign = right ? "right" : "left";
    g.textBaseline = "alphabetic";
    g.lineJoin = "round";
    const x = right ? w - pad : pad;
    // Each line's size, shrunk to fit: the credit may be wider than a small picture.
    const lines = marks.map(([text, k]) => {
      let px = k === 1 ? size : Math.max(8, Math.round(size * k));
      g.font = `600 ${px}px ${family}`;
      while (g.measureText(text).width > w - pad * 2 && px > 8) g.font = `600 ${--px}px ${family}`;
      return [text, px];
    });
    // marks run from the bottom up; in a top corner the stack starts at the top.
    const stack = top ? [...lines].reverse() : lines;
    let y = top ? Math.min(h - pad, insetTop + pad + stack[0][1]) : h - pad;
    stack.forEach(([text, px], i) => {
      g.font = `600 ${px}px ${family}`;
      // Dark text on a light corner, white on a dark one, with a soft outline.
      const tw = Math.max(1, Math.min(w, Math.ceil(g.measureText(text).width)));
      const left = right ? Math.max(0, x - tw) : x;
      const data = g.getImageData(left, Math.max(0, y - px), tw, Math.max(1, Math.min(h, px))).data;
      let sum = 0;
      for (let j = 0; j < data.length; j += 4) sum += 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
      const light = sum / (data.length / 4) > 140;
      g.lineWidth = Math.max(2, px / 5);
      g.strokeStyle = light ? `rgba(255, 255, 255, ${strokeLight})` : `rgba(0, 0, 0, ${strokeDark})`;
      g.strokeText(text, x, y);
      g.fillStyle = light ? `rgba(29, 35, 43, ${fillLight})` : `rgba(255, 255, 255, ${fillDark})`;
      g.fillText(text, x, y);
      // Down by the next line's size from a top corner, up by this one's from a bottom one.
      y += top ? Math.round((stack[i + 1]?.[1] ?? px) * 1.25) : -Math.round(px * 1.25);
    });
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
  const credit = creditOf(imd);
  if (credit && text && !text.includes(credit)) text = `${text} ${credit}.`;
  const type = blob.type || "image/png";
  // The user's own words (Settings) after every picture's message, not the backup's.
  const { caption, brand, full } = shareLook();
  // Without the MyWeather name the message leaves out "Shared from MyWeather." too.
  if (!brand && text) text = text.replace(/\s*Shared from MyWeather\.?/g, "").trim();
  if (caption && type.startsWith("image/")) text = text ? `${text} ${caption}` : caption;
  const bridge = window.MyWeatherAndroid;
  if (bridge && typeof bridge.postMessage === "function") {
    const data = await toBase64(blob);
    // asFile: sent as a plain file, so WhatsApp and similar apps keep every pixel instead of shrinking it as a "photo".
    bridge.postMessage(JSON.stringify({ action: "shareImage", data, type, name, text, asFile: full && STAMPABLE.has(type) }));
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
