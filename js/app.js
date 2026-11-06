import { STATIONS, PRODUCTS, radarImageUrl } from "./stations.js";

const REFRESH_MS = 10 * 60 * 1000; // IMD updates radar roughly every 10 minutes
const STORAGE_KEY = "myweather.radar";

const citySelect = document.getElementById("city");
const productSelect = document.getElementById("product");
const img = document.getElementById("radar-img");
const link = document.getElementById("radar-link");
const status = document.getElementById("status");
const refreshBtn = document.getElementById("refresh");

for (const s of STATIONS) citySelect.add(new Option(s.name, s.code));
for (const p of PRODUCTS) productSelect.add(new Option(p.name, p.code));

// Initial selection: URL (?city=cni&product=caz) > last choice > Chennai.
const params = new URLSearchParams(location.search);
let saved = {};
try {
  saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
} catch {}
const pick = (value, list, fallback) =>
  list.some((x) => x.code === value) ? value : fallback;
citySelect.value = pick(params.get("city") ?? saved.city, STATIONS, "cni");
productSelect.value = pick(params.get("product") ?? saved.product, PRODUCTS, "caz");

function render() {
  const city = citySelect.value;
  const product = productSelect.value;
  const url = radarImageUrl(city, product);

  link.href = url;
  link.textContent = url;
  status.textContent = "Loading…";
  status.className = "status";
  // Cache-buster so the browser fetches the latest frame; the link stays clean.
  img.src = `${url}?t=${Date.now()}`;
  img.alt = `${PRODUCTS.find((p) => p.code === product).name} radar for ${
    STATIONS.find((s) => s.code === city).name
  }`;

  const qs = new URLSearchParams({ city, product });
  history.replaceState(null, "", `?${qs}`);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ city, product }));
  } catch {}
}

img.addEventListener("load", () => {
  status.textContent = `Updated ${new Date().toLocaleTimeString()}`;
});
img.addEventListener("error", () => {
  status.textContent =
    "Image not available right now. This radar may be offline; try another city or product.";
  status.className = "status error";
});

citySelect.addEventListener("change", render);
productSelect.addEventListener("change", render);
refreshBtn.addEventListener("click", render);
setInterval(render, REFRESH_MS);

render();
