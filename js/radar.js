import { STATIONS, PRODUCTS, radarImageUrl, radarAnimationUrl, hasAnimation } from "./stations.js";

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
  animateBtn.addEventListener("click", () => {
    animate = !animate;
    render();
  });

  img.addEventListener("load", () => {
    const what = img.dataset.anim ? "Playing the last 3 hours, loaded" : "Updated";
    status.textContent = `${what} ${new Date().toLocaleTimeString()}`;
    status.className = "status";
  });
  img.addEventListener("error", () => {
    status.textContent =
      "Image not available right now. This radar may be offline; try another city or product.";
    status.className = "status error";
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
  status.textContent = playing ? "Loading the 3-hour loop (a few MB)…" : "Loading…";
  status.className = "status";
  // Cache-buster so the browser fetches the latest frame; the link stays clean.
  img.src = `${url}?t=${Date.now()}`;
  img.dataset.anim = playing ? "1" : "";
  img.alt = `${nameOf(PRODUCTS, product)} radar ${playing ? "loop" : "image"} for ${nameOf(STATIONS, city)}`;

  // Keep the choice in the URL so it can be bookmarked or shared.
  const qs = new URLSearchParams({ city, product });
  if (playing) qs.set("anim", "1");
  history.replaceState(null, "", `?${qs}#radar`);
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
