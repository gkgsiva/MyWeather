// Share buttons on maps, tables, charts and lists: each block marked
// data-share="Title" in index.html gets a small Share button. It turns the
// block, as it is on screen, into a picture (html-to-image, bundled in
// js/vendor) with a MyWeather band on top naming it and the time, and hands
// it to the phone's share sheet through share.js.
//
// Maps are shared as they are on screen: the same place, zoom and markers.
// Tables are shared whole, including columns scrolled off to the side.
// data-share-from="id id" adds the text of those elements to the title (a
// select gives its chosen option), e.g. "Station map · Rain today".
import { shareImage, shareName } from "./share.js";
import { shareLook } from "./prefs.js";

let lib = null;
function loadLib() {
  if (window.htmlToImage) return Promise.resolve(window.htmlToImage);
  lib ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "js/vendor/html-to-image/html-to-image.js";
    s.onload = () => resolve(window.htmlToImage);
    s.onerror = () => {
      lib = null;
      reject(new Error("picture maker didn't load"));
    };
    document.head.append(s);
  });
  return lib;
}

const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();

// "Station map · Rain today", from data-share and data-share-from.
function titleOf(block) {
  const parts = [clean(block.dataset.share)];
  for (const id of (block.dataset.shareFrom || "").split(/\s+/).filter(Boolean)) {
    const el = document.getElementById(id);
    if (!el || el.closest("[hidden]")) continue;
    const text = clean(
      el instanceof HTMLSelectElement ? el.selectedOptions[0]?.text : el instanceof HTMLInputElement ? fmtInput(el) : el.textContent
    );
    if (text && text.length <= 60 && !parts.includes(text)) parts.push(text);
  }
  return parts.filter(Boolean).join(" · ") || "MyWeather";
}

// A date box as "7 Nov 2026"; other inputs as typed.
function fmtInput(el) {
  if (el.type === "date" && el.value) {
    const d = new Date(`${el.value}T12:00:00`);
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  }
  return el.type === "range" ? "" : el.value;
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "view";

function stamp(d = new Date()) {
  const day = d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  return `${day}, ${time}`;
}

// Not in the picture: Share buttons, map zoom buttons, the add-a-spot cross,
// and anything marked snap-skip (sliders, play buttons).
function keep(node) {
  if (!(node instanceof Element)) return true;
  return !node.matches(".snap-btn, .snap-bar, .snap-skip, .leaflet-control-zoom, .map-cross");
}

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// The charts are coloured by the stylesheet, which the picture maker doesn't
// carry into SVG drawings, so their colours are written onto each shape for
// the moment the picture is made.
const SVG_PROPS = [
  "fill", "fill-opacity", "stroke", "stroke-width", "stroke-dasharray", "stroke-opacity", "stroke-linecap",
  "stroke-linejoin", "opacity", "font-size", "font-weight", "font-family", "text-anchor", "dominant-baseline", "display",
  "visibility",
];
function inlineSvgStyles(block) {
  const saved = [];
  for (const node of block.querySelectorAll("svg *")) {
    const cs = getComputedStyle(node);
    saved.push([node, node.getAttribute("style")]);
    node.setAttribute("style", `${node.getAttribute("style") || ""};${SVG_PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(";")}`);
  }
  return () => {
    for (const [node, style] of saved) {
      if (style == null) node.removeAttribute("style");
      else node.setAttribute("style", style);
    }
  };
}

// Canvas limits on phones: one side up to 16384 px, and a modest total area.
const MAX_SIDE = 16000;
const MAX_AREA = 48e6;
const WANT = 3; // sharp on every phone screen; the picture is never smaller than the screen's own pixels
const SHARP = 2; // below this a tall picture is split into parts instead of shrunk

// The biggest pixel ratio (up to what the screen has, at least 2) that fits the canvas.
function ratioFor(width, height) {
  const want = Math.min(WANT, Math.max(2, window.devicePixelRatio || 1));
  const side = MAX_SIDE / Math.max(width, height);
  const area = Math.sqrt(MAX_AREA / Math.max(1, width * height));
  return Math.max(1, Math.min(want, side, area));
}

async function shoot(h2i, block, bg) {
  const width = Math.ceil(Math.max(block.scrollWidth, block.getBoundingClientRect().width));
  const height = Math.ceil(Math.max(block.scrollHeight, block.getBoundingClientRect().height));
  return {
    ratio: ratioFor(width, height),
    shot: await h2i.toCanvas(block, {
      width,
      height,
      pixelRatio: ratioFor(width, height),
      backgroundColor: bg,
      filter: keep,
      // The block's own padding and margins stay out; the picture adds its own.
      style: { margin: "0" },
    }),
  };
}

/** The block as pictures with a band naming each and the time on top: one, or parts when a long table would not stay sharp. */
export async function snapBlocks(block, title) {
  const h2i = await loadLib();
  const bg = css("--bg") || "#ffffff";
  // Whole tables, not just the part scrolled into view.
  block.classList.add("snapping");
  const undo = inlineSvgStyles(block);
  const shots = [];
  try {
    let { ratio, shot } = await shoot(h2i, block, bg);
    const rows = [...block.querySelectorAll("tbody tr")];
    if (ratio < SHARP && rows.length > 20) {
      // Too tall to keep sharp in one picture: show a share of the rows at a time.
      const parts = Math.min(8, Math.ceil(SHARP / ratio));
      const per = Math.ceil(rows.length / parts);
      for (let i = 0; i < parts; i++) {
        rows.forEach((r, n) => {
          r.style.display = n >= i * per && n < (i + 1) * per ? "" : "none";
        });
        shots.push((await shoot(h2i, block, bg)).shot);
      }
      rows.forEach((r) => (r.style.display = ""));
    } else shots.push(shot);
  } finally {
    undo();
    block.classList.remove("snapping");
  }
  const blobs = [];
  for (let i = 0; i < shots.length; i++) {
    blobs.push(await frame(shots[i], shots.length > 1 ? `${title} (part ${i + 1} of ${shots.length})` : title));
  }
  return blobs;
}

export async function snapBlock(block, title) {
  return (await snapBlocks(block, title))[0];
}

// Words split into lines that fit the width.
function wrap(g, text, width) {
  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (line && g.measureText(next).width > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

// The time it was shared; just the time when the title already has today's date.
function when(title) {
  const d = new Date();
  const day = d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  return title.includes(day) ? d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : stamp(d);
}

// A band on top ("MyWeather", what it is, when) and a margin around the shot.
// Settings can leave out the MyWeather name (brand: the band's first line and
// the footer) and the date and time (time).
function frame(shot, title, look = shareLook()) {
  const scale = shot.width / Math.max(1, parseFloat(shot.style.width) || shot.width);
  const pad = Math.round(12 * scale);
  const foot = look.brand ? Math.round(26 * scale) : pad;
  const font = getComputedStyle(document.body).fontFamily;
  const out = document.createElement("canvas");
  out.width = Math.max(shot.width + pad * 2, Math.round(320 * scale));
  const g = out.getContext("2d");
  // The title and time, on as many lines as they need.
  g.font = `${Math.round(13 * scale)}px ${font}`;
  const lines = wrap(g, look.time ? `${title} · ${when(title)}` : title, out.width - pad * 2);
  // Without the name the band holds just the title lines.
  const first = look.brand ? 45 : 22;
  const band = Math.round((first + 11 + (lines.length - 1) * 18) * scale);
  out.height = band + pad + shot.height + foot;
  g.fillStyle = css("--bg") || "#ffffff";
  g.fillRect(0, 0, out.width, out.height);
  g.fillStyle = css("--header-bg") || "#1565c0";
  g.fillRect(0, 0, out.width, band);
  g.fillStyle = css("--header-fg") || "#ffffff";
  g.textBaseline = "alphabetic";
  if (look.brand) {
    g.font = `700 ${Math.round(17 * scale)}px ${font}`;
    g.fillText("MyWeather", pad, Math.round(24 * scale), out.width - pad * 2);
  }
  g.font = `${look.brand ? "" : "600 "}${Math.round(13 * scale)}px ${font}`;
  g.globalAlpha = 0.9;
  lines.forEach((line, i) => g.fillText(line, pad, Math.round((first + i * 18) * scale), out.width - pad * 2));
  g.globalAlpha = 1;
  g.drawImage(shot, pad, band + pad);
  if (look.brand) {
    g.fillStyle = css("--muted") || "#5d6773";
    g.font = `${Math.round(11 * scale)}px ${font}`;
    g.fillText("Shared from the MyWeather app", pad, out.height - Math.round(9 * scale), out.width - pad * 2);
  }
  return new Promise((resolve, reject) =>
    out.toBlob((b) => {
      if (!b) return reject(new Error("no picture"));
      // A mark in a top corner goes under the band (js/share.js watermark()).
      b.markTop = band;
      resolve(b);
    }, "image/png")
  );
}

// Where the button goes: in the block's heading row when it starts with one, over the
// map's top right corner for a map, otherwise in a small row above the block.
function place(block, button) {
  const first = block.firstElementChild;
  const head = first?.matches(".chart-head, h3") ? first : null;
  if (head?.classList.contains("chart-head")) {
    head.append(button);
    return;
  }
  if (block.querySelector(".station-map")) {
    button.classList.add("snap-over");
    block.prepend(button);
    return;
  }
  if (head) {
    head.classList.add("snap-head");
    head.append(button);
    return;
  }
  const bar = document.createElement("div");
  bar.className = "snap-bar";
  bar.append(button);
  block.prepend(bar);
}

// A short message under the button for a few seconds.
function toast(text, error) {
  let t = document.getElementById("snap-toast");
  if (!t) {
    t = Object.assign(document.createElement("p"), { id: "snap-toast", className: "snap-toast", role: "status" });
    document.body.append(t);
  }
  t.textContent = text;
  t.classList.toggle("error", !!error);
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => (t.hidden = true), 4000);
}

const ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5M5 13v6h14v-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export function initSnaps(root = document) {
  for (const block of root.querySelectorAll("[data-share]")) {
    if (block.querySelector(":scope .snap-btn")) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary small snap-btn";
    button.innerHTML = `${ICON}<span>Share</span>`;
    button.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (button.disabled) return;
      const title = titleOf(block);
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      try {
        const blobs = await snapBlocks(block, title);
        let how;
        for (let i = 0; i < blobs.length; i++) {
          const part = blobs.length > 1 ? ` (part ${i + 1} of ${blobs.length})` : "";
          if (i) toast(`Sharing part ${i + 1} of ${blobs.length}…`);
          how = await shareImage({
            blob: blobs[i],
            name: shareName(slug(title + part), "image/png"),
            text: shareLook().time ? `${title}${part}, ${when(title)}. Shared from MyWeather.` : `${title}${part}. Shared from MyWeather.`,
            // Blocks showing IMD's pictures (radar, warnings) credit IMD;
            // data-share-credit names another agency (Cyclone watch).
            imd: block.dataset.shareCredit || "shareImd" in block.dataset,
          });
          if (how === "cancelled") break;
        }
        if (how === "downloaded") toast("Sharing isn't available here, so the picture was downloaded.");
      } catch (err) {
        toast(`Couldn't make the picture (${err.message || err}).`, true);
      } finally {
        button.disabled = false;
        button.removeAttribute("aria-busy");
      }
    });
    // Leaflet would take a tap on the map's button as a map click or drag.
    for (const ev of ["mousedown", "touchstart", "pointerdown", "dblclick", "wheel"]) {
      button.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
    }
    place(block, button);
  }
}
