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

/** The block as a picture with a band naming it and the time on top. */
export async function snapBlock(block, title) {
  const h2i = await loadLib();
  const bg = css("--bg") || "#ffffff";
  // Whole tables, not just the part scrolled into view.
  block.classList.add("snapping");
  const undo = inlineSvgStyles(block);
  let shot;
  try {
    const width = Math.ceil(Math.max(block.scrollWidth, block.getBoundingClientRect().width));
    const height = Math.ceil(Math.max(block.scrollHeight, block.getBoundingClientRect().height));
    shot = await h2i.toCanvas(block, {
      width,
      height,
      pixelRatio: Math.min(2, Math.max(1, window.devicePixelRatio || 1)),
      backgroundColor: bg,
      filter: keep,
      // The block's own padding and margins stay out; the picture adds its own.
      style: { margin: "0" },
    });
  } finally {
    undo();
    block.classList.remove("snapping");
  }
  return frame(shot, title);
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
function frame(shot, title) {
  const scale = shot.width / Math.max(1, parseFloat(shot.style.width) || shot.width);
  const pad = Math.round(12 * scale);
  const foot = Math.round(26 * scale);
  const font = getComputedStyle(document.body).fontFamily;
  const out = document.createElement("canvas");
  out.width = Math.max(shot.width + pad * 2, Math.round(320 * scale));
  const g = out.getContext("2d");
  // The title and time, on as many lines as they need.
  g.font = `${Math.round(13 * scale)}px ${font}`;
  const lines = wrap(g, `${title} · ${when(title)}`, out.width - pad * 2);
  const band = Math.round((56 + (lines.length - 1) * 18) * scale);
  out.height = band + pad + shot.height + foot;
  g.fillStyle = css("--bg") || "#ffffff";
  g.fillRect(0, 0, out.width, out.height);
  g.fillStyle = css("--header-bg") || "#1565c0";
  g.fillRect(0, 0, out.width, band);
  g.fillStyle = css("--header-fg") || "#ffffff";
  g.textBaseline = "alphabetic";
  g.font = `700 ${Math.round(17 * scale)}px ${font}`;
  g.fillText("MyWeather", pad, Math.round(24 * scale), out.width - pad * 2);
  g.font = `${Math.round(13 * scale)}px ${font}`;
  g.globalAlpha = 0.9;
  lines.forEach((line, i) => g.fillText(line, pad, Math.round((45 + i * 18) * scale), out.width - pad * 2));
  g.globalAlpha = 1;
  g.drawImage(shot, pad, band + pad);
  g.fillStyle = css("--muted") || "#5d6773";
  g.font = `${Math.round(11 * scale)}px ${font}`;
  g.fillText("Shared from the MyWeather app", pad, out.height - Math.round(9 * scale), out.width - pad * 2);
  return new Promise((resolve, reject) =>
    out.toBlob((b) => (b ? resolve(b) : reject(new Error("no picture"))), "image/png")
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
        const blob = await snapBlock(block, title);
        const how = await shareImage({
          blob,
          name: shareName(slug(title), "image/png"),
          text: `${title}, ${when(title)}. Shared from MyWeather.`,
          // Blocks showing IMD's pictures (radar, warnings) credit IMD.
          imd: "shareImd" in block.dataset,
        });
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
