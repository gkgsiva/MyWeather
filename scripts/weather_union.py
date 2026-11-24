#!/usr/bin/env python3
"""Reads Weather Union's locality stations in Chennai and other Tamil Nadu cities.

Weather Union (weatherunion.com, Zomato) runs automatic weather stations
(device type 1: temperature, humidity, wind and rain) and rain gauges (type 2:
rain only) in city localities. Its API needs a key, so the key lives only in
the repository secret WEATHER_UNION_KEY and this script runs in a workflow
(.github/workflows/weather-union.yml); the app reads the JSON it writes.

  python3 scripts/weather_union.py OUTDIR [--verbose] [--all]

The list of localities (id, name, position) is read from weatherunion.com's own
page and kept in OUTDIR/localities.json, which is used if the page can't be
read. Chennai's localities are read on every run (hourly); the other Tamil Nadu
cities every third hour (or with --all). Writes OUTDIR/latest.json (one reading
per locality) and OUTDIR/history.json (the last 48 readings per locality, plus
each day's rain total for 62 days). Prints "latest" when something was written.
The key is never printed or written.
"""
import json, os, re, sys, time, urllib.request, urllib.parse
from datetime import datetime, timezone, timedelta

API = "https://www.weatherunion.com/gw/weather/external/v0/get_locality_weather_data"
PAGE = "https://www.weatherunion.com/"
# Cities (as Weather Union names them) shown in the app.
TN_CITIES = {
    "Chennai", "Coimbatore", "Salem", "Madurai", "Tiruchirappalli", "Trichy",
    "Tirunelveli", "Erode", "Vellore", "Thoothukudi", "Tuticorin", "Thanjavur",
    "Tiruppur", "Hosur", "Kanyakumari", "Nagercoil", "Karur", "Dindigul",
    "Kanchipuram", "Tiruvannamalai", "Cuddalore", "Puducherry", "Pondicherry",
}
OTHER_CAP = 25  # localities outside Chennai, to stay under 1000 calls a day
KEEP = 48
verbose = "--verbose" in sys.argv
out = sys.argv[1]
os.makedirs(out, exist_ok=True)
key = os.environ.get("WEATHER_UNION_KEY", "").strip()
if not key:
    print("WEATHER_UNION_KEY is not set", file=sys.stderr)
    sys.exit(1)
IST = timezone(timedelta(hours=5, minutes=30))


def jload(name, default):
    try:
        return json.load(open(os.path.join(out, name)))
    except (OSError, ValueError):
        return default


def num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f else None


def discover():
    """TN localities from the site's page: [{id, name, city, lat, lon, dev}]."""
    req = urllib.request.Request(PAGE, headers={"User-Agent": "MyWeather"})
    with urllib.request.urlopen(req, timeout=40) as r:
        t = r.read().decode("utf-8", "replace").replace('\\"', '"')
    dec = json.JSONDecoder()
    found = []
    for m in re.finditer(r'\{"city_id":"ZWC\d+"', t):
        try:
            c, _ = dec.raw_decode(t[m.start():])
        except ValueError:
            continue
        city = c.get("city_name")
        if city not in TN_CITIES:
            continue
        for v in (c.get("localities") or {}).values():
            la, lo = num(v.get("latitude")), num(v.get("longitude"))
            if v.get("locality_id") and la is not None and lo is not None:
                found.append({
                    "id": v["locality_id"], "name": v.get("locality_name") or v["locality_id"],
                    "city": city, "lat": la, "lon": lo, "dev": v.get("device_type"),
                })
    seen, uniq = set(), []
    for l in found:
        if l["id"] not in seen:
            seen.add(l["id"])
            uniq.append(l)
    chennai = [l for l in uniq if l["city"] == "Chennai"]
    other = [l for l in uniq if l["city"] != "Chennai"][:OTHER_CAP]
    return chennai + other


try:
    locs = discover()
    if not locs:
        raise RuntimeError("no localities in the page")
    json.dump(locs, open(os.path.join(out, "localities.json"), "w"), separators=(",", ":"))
except Exception as e:  # noqa: BLE001
    print(f"Couldn't read the locality list from the page ({type(e).__name__}: {e}); using the saved one", file=sys.stderr)
    locs = jload("localities.json", [])
if not locs:
    print("No localities known", file=sys.stderr)
    sys.exit(1)
if verbose:
    by = {}
    for l in locs:
        by.setdefault(l["city"], []).append(l)
    for c, ls in by.items():
        print(f"{c}: {len(ls)} localities ({sum(1 for l in ls if l['dev'] == 1)} weather stations, {sum(1 for l in ls if l['dev'] == 2)} rain gauges)")

prev = jload("latest.json", {})
prev_other = [r for r in prev.get("readings", []) if r.get("region") == "tn"]
with_other = "--all" in sys.argv or datetime.now(timezone.utc).hour % 3 == 0 or not prev_other


def fetch(lid):
    url = API + "?" + urllib.parse.urlencode({"locality_id": lid})
    req = urllib.request.Request(url, headers={"X-Zomato-API-Key": key, "User-Agent": "MyWeather"})
    err = "error"
    for attempt in range(2):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001
            err = getattr(e, "code", None) or type(e).__name__
            if attempt == 0:
                time.sleep(3)
    raise RuntimeError(f"failed ({err})")


def label(l):
    return l["name"] if l["city"] == "Chennai" else f"{l['name']}, {l['city']}"


readings, errors = [], []
for l in locs:
    region = "chennai" if l["city"] == "Chennai" else "tn"
    if region == "tn" and not with_other:
        continue
    try:
        j = fetch(l["id"])
    except RuntimeError as e:
        errors.append(f"{label(l)}: {e}")
        continue
    d = j.get("locality_weather_data") or {}
    r = {
        "name": label(l), "region": region, "id": l["id"], "dev": j.get("device_type") or l["dev"],
        "lat": l["lat"], "lon": l["lon"],
        "temp": num(d.get("temperature")), "humidity": num(d.get("humidity")),
        "wind": num(d.get("wind_speed")), "dir": num(d.get("wind_direction")),
        "rain": num(d.get("rain_intensity")), "rainTotal": num(d.get("rain_accumulation")),
    }
    if all(r[k] is None for k in ("temp", "humidity", "wind", "rain", "rainTotal")):
        errors.append(f"{label(l)}: no readings in the answer")
        continue
    readings.append(r)
    time.sleep(0.2)

if not [r for r in readings if r["region"] == "chennai"]:
    print("No Chennai readings; errors: " + "; ".join(errors), file=sys.stderr)
    sys.exit(1)
fresh = list(readings)
if not with_other:
    readings += prev_other  # not read this run: keep the last ones

now = datetime.now(IST)
latest = {"at": now.isoformat(timespec="minutes"), "readings": readings, "errors": errors}
json.dump(latest, open(os.path.join(out, "latest.json"), "w"), separators=(",", ":"))

hist = jload("history.json", {"areas": {}})
hist.setdefault("areas", {})
for r in fresh:
    rows = hist["areas"].setdefault(r["name"], [])
    rows.append([latest["at"], r["temp"], r["humidity"], r["rain"], r["rainTotal"]])
    del rows[:-KEEP]
    if r["rainTotal"] is not None:
        days = hist.setdefault("days", {}).setdefault(r["name"], {})
        day = latest["at"][:10]
        days[day] = max(days.get(day, 0), r["rainTotal"])
        for old in sorted(days)[:-62]:
            del days[old]
json.dump(hist, open(os.path.join(out, "history.json"), "w"), separators=(",", ":"))
print(f"{len(readings)} localities" + (f"; errors: {errors}" if errors else ""), file=sys.stderr)
print("latest")
