// IMD INSAT-3D/3DR satellite pictures, as listed on
// https://mausam.imd.gov.in/responsive/satellite.php
import { shareButton, shareName } from "./share.js";

const BASE = "https://mausam.imd.gov.in/Satellite/";
const KEY = "myweather.satellite";

export const SAT_IMAGES = [
  { code: "3Dasiasec_ir1.jpg", name: "Asia sector · Infrared" },
  { code: "3Dasiasec_vis.jpg", name: "Asia sector · Visible (daytime)" },
  { code: "3Dasiasec_wv.jpg", name: "Asia sector · Water vapour" },
  { code: "3Dasiasec_ctbt.jpg", name: "Asia sector · Cloud top temperature" },
  { code: "Converted/IR1.gif", name: "Animation · Infrared", anim: true },
  { code: "Converted/VIS.gif", name: "Animation · Visible", anim: true },
  { code: "Converted/WV.gif", name: "Animation · Water vapour", anim: true },
  { code: "Converted/CTBT.gif", name: "Animation · Cloud top temperature", anim: true },
  { code: "3Dglobe_ir1.jpg", name: "Full disc · Infrared" },
  { code: "3Dglobe_vis.jpg", name: "Full disc · Visible (daytime)" },
  { code: "3Dglobe_wv.jpg", name: "Full disc · Water vapour" },
];

const select = document.getElementById("sat-image");
const img = document.getElementById("sat-img");
const link = document.getElementById("sat-link");
const status = document.getElementById("sat-status");

let ready = false;

function init() {
  for (const s of SAT_IMAGES) select.add(new Option(s.name, s.code));
  let saved = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch {}
  select.value = SAT_IMAGES.some((s) => s.code === saved) ? saved : SAT_IMAGES[0].code;

  select.addEventListener("change", () => {
    try {
      localStorage.setItem(KEY, select.value);
    } catch {}
    render();
  });
  document.getElementById("sat-refresh").addEventListener("click", render);
  shareButton(document.getElementById("sat-share"), shareSatellite, (text, error) => {
    status.textContent = text;
    status.className = error ? "status error" : "status";
  });
  img.addEventListener("load", () => {
    status.textContent = `Updated ${new Date().toLocaleTimeString()}. Pinch to zoom.`;
    status.className = "status";
  });
  img.addEventListener("error", () => {
    status.textContent = "Image not available right now. Try again later or pick another image.";
    status.className = "status error";
  });
  ready = true;
}

function render() {
  const item = SAT_IMAGES.find((s) => s.code === select.value);
  const url = BASE + item.code;
  link.href = url;
  link.textContent = url;
  status.textContent = item.anim ? "Loading the animation (about 10 MB)…" : "Loading…";
  status.className = "status";
  img.src = `${url}?t=${Date.now()}`;
  img.alt = `INSAT satellite: ${item.name}`;
}

// Fetches the picture on screen again (the browser cache usually has it) so
// it can be handed to the share sheet. The app adds the CORS header IMD
// doesn't send.
async function shareSatellite() {
  if (!img.complete || !img.naturalWidth) return null;
  const item = SAT_IMAGES.find((s) => s.code === select.value);
  const res = await fetch(img.src);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  return {
    blob,
    name: shareName("satellite", blob.type),
    text: `INSAT satellite, ${item.name} (IMD). Shared from MyWeather.`,
    imd: true,
  };
}

// Loads the latest picture each time the Satellite menu is opened.
export function showSatellite() {
  if (!ready) init();
  render();
}
