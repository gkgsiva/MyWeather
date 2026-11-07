import { STATIONS, PRODUCTS, radarImageUrl, radarAnimationUrl, hasAnimation } from "./stations.js";
import { saveImage, loadImage, when } from "./offline.js";
import { shareButton, shareName } from "./share.js";

const DEFAULT_KEY = "myweather.radar.default";
const FALLBACK = { city: "cni", product: "caz" }; // Chennai, MAX (Z)

const citySelect = document.getElementById("city");
const productSelect = document.getElementById("product");
const img = document.getElementById("radar-img");
const link = document.getElementById("radar-link");
const status = document.getElementById("status");
const animateBtn = document.getElementById("animate");

// Showing IMD's 3-hour loop instead of the latest image (MAX (Z) and rainfall
// intensity only). Kept in the URL as &anim=1.
let animate = false;
let loadSeq = 0; // ignores answers for an earlier pick
let objectUrl = "";
// The picture on screen and IMD's time for it, for the Share button.
let shown = null;

const pick = (value, list, fallback) =>
  list.some((x) => x.code === value) ? value : fallback;
const nameOf = (list, code) => list.find((x) => x.code === code).name;

function loadDefault() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(DEFAULT_KEY) || "{}");
  } catch {}
  return {
    city: pick(saved.city, STATIONS, FALLBACK.city),
    product: pick(saved.product, PRODUCTS, FALLBACK.product),
  };
}

let ready = false;

function init() {
  for (const s of STATIONS) citySelect.add(new Option(s.name, s.code));
  for (const p of PRODUCTS) productSelect.add(new Option(p.name, p.code));

  // Initial selection: URL (?city=cni&product=caz) > saved default > Chennai.
  const params = new URLSearchParams(location.search);
  const def = loadDefault();
  citySelect.value = pick(params.get("city"), STATIONS, def.city);
  productSelect.value = pick(params.get("product"), PRODUCTS, def.product);
  animate = params.get("anim") === "1";

  citySelect.addEventListener("change", render);
  productSelect.addEventListener("change", render);
  document.getElementById("refresh").addEventListener("click", render);
  document.getElementById("set-default").addEventListener("click", setDefault);
  shareButton(document.getElementById("radar-share"), shareRadar, say);
  animateBtn.addEventListener("click", () => {
    animate = !animate;
    render();
  });

  // Only used when the image can't be fetched (an ordinary browser without
  // the app's CORS header) and is shown straight from IMD instead.
  img.addEventListener("load", () => {
    if (img.dataset.mode !== "direct") return;
    const what = img.dataset.anim ? "Playing the last 3 hours, loaded" : "Updated";
    say(`${what} ${new Date().toLocaleTimeString()}`);
  });
  img.addEventListener("error", () => {
    if (img.dataset.mode !== "direct") return;
    say("Image not available right now. This radar may be offline; try another city or product.", true);
  });
  ready = true;
}

function render() {
  const city = citySelect.value;
  const product = productSelect.value;
  const canAnimate = hasAnimation(product);
  const playing = animate && canAnimate;
  const url = playing ? radarAnimationUrl(city, product) : radarImageUrl(city, product);

  animateBtn.disabled = !canAnimate;
  animateBtn.textContent = playing ? "Show latest image" : "Play last 3 hours";
  animateBtn.setAttribute("aria-pressed", String(playing));
  animateBtn.title = canAnimate ? "" : "IMD animates only MAX (Z) and Surface Rainfall Intensity";

  link.href = url;
  link.textContent = url;
  document.getElementById("radar-floods").hidden = city !== "cni";
  say(playing ? "Loading the 3-hour loop (a few MB)…" : "Loading…");
  img.dataset.anim = playing ? "1" : "";
  loadRadar(url, playing);
  img.alt = `${nameOf(PRODUCTS, product)} radar ${playing ? "loop" : "image"} for ${nameOf(STATIONS, city)}`;

  // Keep the choice in the URL so it can be bookmarked or shared.
  const qs = new URLSearchParams({ city, product });
  if (playing) qs.set("anim", "1");
  history.replaceState(null, "", `?${qs}#radar`);
}

function say(text, error = false) {
  status.textContent = text;
  status.className = error ? "status error" : "status";
}

function showBlob(blob, imdTime) {
  shown = { blob, imdTime };
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(blob);
  img.dataset.mode = "blob";
  img.src = objectUrl;
}

const imdTimeText = (lastModified) =>
  lastModified && !isNaN(Date.parse(lastModified)) ? ` · IMD image of ${when(Date.parse(lastModified))}` : "";

// Fetches the image so a copy can be kept on the phone; with no network the
// last saved copy is shown instead.
async function loadRadar(url, playing) {
  const seq = ++loadSeq;
  let httpError = false;
  try {
    // Cache-buster so the latest frame is fetched; the link stays clean.
    const res = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) {
      httpError = true;
      throw new Error(`HTTP ${res.status}`);
    }
    const blob = await res.blob();
    if (!blob.type.startsWith("image/")) {
      httpError = true;
      throw new Error("not an image");
    }
    if (seq !== loadSeq) return;
    const entry = { blob, savedAt: Date.now(), imdTime: res.headers.get("last-modified") || "" };
    showBlob(blob, entry.imdTime);
    const what = playing ? "Playing the last 3 hours, loaded" : "Updated";
    say(`${what} ${new Date().toLocaleTimeString()}${imdTimeText(entry.imdTime)}`);
    saveImage(url, entry);
  } catch {
    if (seq !== loadSeq) return;
    const saved = await loadImage(url);
    if (seq !== loadSeq) return;
    if (saved) {
      showBlob(saved.blob, saved.imdTime);
      const why = httpError ? "IMD isn't serving this image right now" : "No connection";
      say(`${why}. Showing the copy saved at ${when(saved.savedAt)}${imdTimeText(saved.imdTime)}.`, true);
    } else if (httpError) {
      shown = null;
      img.dataset.mode = "";
      img.removeAttribute("src");
      say("Image not available right now. This radar may be offline; try another city or product.", true);
    } else {
      // Can't fetch it here (no network, or a browser without the app's CORS
      // header): let the image load straight from IMD.
      shown = null;
      img.dataset.mode = "direct";
      img.src = `${url}?t=${Date.now()}`;
    }
  }
}

function shareRadar() {
  if (!shown) return null;
  const city = nameOf(STATIONS, citySelect.value);
  const product = nameOf(PRODUCTS, productSelect.value);
  const loop = img.dataset.anim ? " · last 3 hours" : "";
  const t = Date.parse(shown.imdTime);
  const time = isNaN(t) ? "" : ` · ${when(t)}`;
  return {
    blob: shown.blob,
    name: shareName(`radar-${citySelect.value}`, shown.blob.type),
    text: `${city} radar, ${product}${loop}${time} (IMD). Shared from MyWeather.`,
  };
}

function setDefault() {
  const choice = { city: citySelect.value, product: productSelect.value };
  try {
    localStorage.setItem(DEFAULT_KEY, JSON.stringify(choice));
    status.textContent = `Default set to ${nameOf(STATIONS, choice.city)}, ${nameOf(
      PRODUCTS,
      choice.product
    )}.`;
    status.className = "status";
  } catch {
    status.textContent = "Couldn't save the default on this device.";
    status.className = "status error";
  }
}

// Called each time the Radars menu is opened: loads the latest image once.
// There is no auto-refresh; use the Refresh button.
export function showRadar() {
  if (!ready) init();
  render();
}
