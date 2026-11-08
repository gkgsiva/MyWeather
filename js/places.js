// Finding a place by name or pincode, for Heat and the Home nowcast spot.
// Place names come from Open-Meteo's place list (no key), 6-digit pincodes
// from OpenStreetMap's Nominatim.

async function getJson(u) {
  const res = await fetch(u);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// A place name (Open-Meteo's place list) or a 6-digit pincode (OpenStreetMap's Nominatim).
export async function searchPlaces(q) {
  if (/^\d{6}$/.test(q)) {
    const list = await getJson(
      `https://nominatim.openstreetmap.org/search?${new URLSearchParams({ postalcode: q, countrycodes: "in", format: "json", addressdetails: "1", limit: "3" })}`
    );
    return list.map((r) => {
      const a = r.address || {};
      const where = a.suburb || a.city_district || a.village || a.town || a.city || a.county || "";
      return { lat: Number(r.lat), lon: Number(r.lon), name: `${q}${where ? ` ${where}` : ""}`, detail: r.display_name };
    });
  }
  const data = await getJson(`https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: q, count: "6", countryCode: "IN", language: "en" })}`);
  return (data.results || []).map((r) => ({
    lat: r.latitude,
    lon: r.longitude,
    name: r.name,
    detail: [r.admin3, r.admin2, r.admin1].filter(Boolean).join(", "),
  }));
}

