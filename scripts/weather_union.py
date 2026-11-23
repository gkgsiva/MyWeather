#!/usr/bin/env python3
"""Reads Weather Union's nearest-station weather for points around Chennai.

Weather Union (weatherunion.com, Zomato) runs automatic weather stations in
city localities. Its API needs a key, so the key lives only in the repository
secret WEATHER_UNION_KEY and this script runs in a workflow
(.github/workflows/weather-union.yml); the app reads the JSON it writes.

  python3 scripts/weather_union.py OUTDIR [--verbose]

Writes OUTDIR/latest.json (one reading per area) and OUTDIR/history.json (the
last 48 readings per area, plus each day's rain total for 62 days). Prints "latest" when
something was written. The key is never printed or written.
"""
import json, os, sys, time, urllib.request, urllib.parse
from datetime import datetime, timezone, timedelta

BASE = "https://www.weatherunion.com/gw/weather/external/v01/get_weather_data"
# Areas of Chennai. Weather Union answers with the station nearest each point.
AREAS = [
    ("T. Nagar", 13.0418, 80.2341), ("Anna Nagar", 13.0850, 80.2101),
    ("Adyar", 13.0012, 80.2565), ("Velachery", 12.9815, 80.2180),
    ("Tambaram", 12.9249, 80.1000), ("Guindy", 13.0067, 80.2206),
    ("Mylapore", 13.0368, 80.2676), ("Egmore", 13.0732, 80.2609),
    ("Perambur", 13.1186, 80.2330), ("Manali", 13.1667, 80.2606),
    ("Ambattur", 13.1143, 80.1548), ("Porur", 13.0382, 80.1565),
    ("Sholinganallur", 12.9010, 80.2279), ("Perungudi", 12.9650, 80.2461),
    ("Avadi", 13.1067, 80.0970), ("Pallavaram", 12.9675, 80.1491),
]
KEEP = 48
verbose = "--verbose" in sys.argv
out = sys.argv[1]
key = os.environ.get("WEATHER_UNION_KEY", "").strip()
if not key:
    print("WEATHER_UNION_KEY is not set", file=sys.stderr)
    sys.exit(1)
IST = timezone(timedelta(hours=5, minutes=30))


def num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f else None


def fetch(lat, lon):
    url = BASE + "?" + urllib.parse.urlencode({"latitude": lat, "longitude": lon})
    req = urllib.request.Request(url, headers={"X-Zomato-Api-Key": key, "User-Agent": "MyWeather"})
    for attempt in range(2):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001
            err = getattr(e, "code", None) or type(e).__name__
            if attempt == 0:
                time.sleep(3)
    raise RuntimeError(f"failed ({err})")


readings, errors = [], []
for name, lat, lon in AREAS:
    try:
        j = fetch(lat, lon)
    except RuntimeError as e:
        errors.append(f"{name}: {e}")
        continue
    d = j.get("locality_weather_data") or j.get("data") or {}
    if verbose:
        print(name, "keys:", sorted(j.keys()), "data keys:", sorted(d.keys()))
    r = {
        "name": name, "lat": lat, "lon": lon,
        "temp": num(d.get("temperature")), "humidity": num(d.get("humidity")),
        "wind": num(d.get("wind_speed")), "dir": num(d.get("wind_direction")),
        "rain": num(d.get("rain_intensity")), "rainTotal": num(d.get("rain_accumulation")),
    }
    if all(r[k] is None for k in ("temp", "humidity", "wind", "rain", "rainTotal")):
        errors.append(f"{name}: no readings in the answer")
        continue
    readings.append(r)
    time.sleep(0.3)

if not readings:
    print("No readings; errors: " + "; ".join(errors), file=sys.stderr)
    sys.exit(1)

now = datetime.now(IST)
os.makedirs(out, exist_ok=True)
latest = {"at": now.isoformat(timespec="minutes"), "readings": readings, "errors": errors}
json.dump(latest, open(os.path.join(out, "latest.json"), "w"), separators=(",", ":"))

hp = os.path.join(out, "history.json")
try:
    hist = json.load(open(hp))
except (OSError, ValueError):
    hist = {"areas": {}}
for r in readings:
    rows = hist["areas"].setdefault(r["name"], [])
    rows.append([latest["at"], r["temp"], r["humidity"], r["rain"], r["rainTotal"]])
    del rows[:-KEEP]
    if r["rainTotal"] is not None:
        days = hist.setdefault("days", {}).setdefault(r["name"], {})
        day = latest["at"][:10]
        days[day] = max(days.get(day, 0), r["rainTotal"])
        for old in sorted(days)[:-62]:
            del days[old]
json.dump(hist, open(hp, "w"), separators=(",", ":"))
print(f"{len(readings)} areas" + (f"; errors: {errors}" if errors else ""), file=sys.stderr)
print("latest")
