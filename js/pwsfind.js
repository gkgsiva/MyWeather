// Find Wunderground stations near a place (Manage stations → Find stations).
// The place name or pincode is looked up with js/places.js, then Wunderground's
// "near" list (api.weather.com v3/location/near, product pws, same API key as
// the readings) gives the personal weather stations around it. Each result has
// a nickname box (filled with the station's own name) and an Add button; the
// station's position is kept so it shows on the Station map at once.
import { searchPlaces } from "./places.js";

const COORDS_KEY = "myweather.pws.coords";
const $ = (id) => document.getElementById(id);

function keepPosition(id, lat, lon) {
  try {
    const c = JSON.parse(localStorage.getItem(COORDS_KEY)) || {};
    c[id] = [lat, lon];
    localStorage.setItem(COORDS_KEY, JSON.stringify(c));
  } catch {}
}

async function nearby(lat, lon, key) {
  const qs = new URLSearchParams({ geocode: `${lat},${lon}`, product: "pws", format: "json", apiKey: key });
  const res = await fetch(`https://api.weather.com/v3/location/near?${qs}`);
  if (res.status === 401 || res.status === 403) throw new Error("Wunderground didn't accept the API key");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const l = (await res.json()).location || {};
  return (l.stationId || [])
    .map((id, i) => ({
      id,
      name: l.stationName?.[i] || id,
      lat: l.latitude?.[i],
      lon: l.longitude?.[i],
      km: l.distanceKm?.[i],
    }))
    .filter((s) => /^[A-Z0-9]{3,20}$/.test(s.id));
}

const nickFrom = (name) => String(name || "").replace(/\s+/g, " ").trim().slice(0, 40);

// ctx: { key(): string, has(id): bool, add(name, id): void, say(text, error) }
export function initFind(ctx) {
  const form = $("pws-find");
  const list = $("pws-find-results");
  const note = $("pws-find-note");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = $("pws-find-q").value.trim();
    if (!q) return;
    const key = ctx.key();
    if (!key) return ctx.say("Add your Wunderground API key below first.", true);
    list.replaceChildren();
    note.textContent = "Searching…";
    try {
      const places = await searchPlaces(q);
      const place = places.find((p) => /tamil nadu|puducherry/i.test(p.detail)) || places[0];
      if (!place) {
        note.textContent = "No place found with that name. Try a pincode or a bigger town nearby.";
        return;
      }
      const found = await nearby(place.lat, place.lon, key);
      note.textContent = found.length
        ? `${found.length} stations near ${place.name}${place.detail ? ` (${place.detail})` : ""}. Give each a nickname and tap Add.`
        : `No Wunderground stations near ${place.name}.`;
      list.replaceChildren(...found.map(row));
    } catch (err) {
      note.textContent = `Couldn't search (${err.message}).`;
    }
  });

  function row(s) {
    const li = document.createElement("li");
    li.className = "pws-find-row";
    li.innerHTML = `<span><strong></strong><small></small></span><input maxlength="40" aria-label="Nickname" /><button type="button"></button>`;
    li.querySelector("strong").textContent = s.name;
    li.querySelector("small").textContent = `${s.id}${typeof s.km === "number" ? ` · ${s.km.toFixed(1)} km away` : ""}`;
    const input = li.querySelector("input");
    input.value = nickFrom(s.name);
    const btn = li.querySelector("button");
    const sync = () => {
      const has = ctx.has(s.id);
      btn.textContent = has ? "Added" : "Add";
      btn.disabled = has;
      input.disabled = has;
    };
    sync();
    btn.addEventListener("click", () => {
      const name = nickFrom(input.value);
      if (!name) return ctx.say("Enter a nickname.", true);
      if (typeof s.lat === "number") keepPosition(s.id, s.lat, s.lon);
      ctx.add(name, s.id);
      sync();
    });
    return li;
  }
}
