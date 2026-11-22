#!/usr/bin/env python3
"""Every active tropical cyclone in the world, for the app's Cyclone watch.

    python3 scripts/world_cyclones.py OUT_DIR [--verbose]

Sources (all free, no key; none send a CORS header, hence the workflow):
  - NOAA National Hurricane Center (Atlantic, East and Central Pacific):
    CurrentStorms.json, each storm's forecast advisory (positions and winds
    to 5 days) and public advisory (headline, watches and warnings), and its
    5-day cone picture.
  - Joint Typhoon Warning Center (West Pacific, North Indian Ocean, Southern
    Hemisphere): its RSS lists the current warnings; each warning's text has
    the position, movement, winds, forecast to 5 days and remarks, and a
    warning picture.
  - GDACS (UN/EU Global Disaster Alert and Coordination System): its alert
    level (Green, Orange, Red) and the countries it expects to be affected,
    matched to the storms above by place; a storm only GDACS knows is listed
    with its position.

Writes OUT_DIR/world.json and OUT_DIR/world/<id>.png (the agency picture).
Past positions are kept from run to run in world.json, so a track builds up
even where the agency publishes only the latest position. Prints a line per
storm on stderr, and "world" on stdout when world.json changed. Exits 0 even
when a source fails (its storms are just missing; the errors are listed).
"""

import json
import math
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from html import unescape

UA = "Mozilla/5.0 (X11; Linux x86_64) MyWeather cyclone reader (github.com/gkgsiva/myweather)"
NHC = "https://www.nhc.noaa.gov/CurrentStorms.json"
JTWC_RSS = "https://www.metoc.navy.mil/jtwc/rss/jtwc.rss"
GDACS = [
    "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=TC&fromdate={a}&todate={b}&alertlevel=Green;Orange;Red",
    "https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP?eventtypes=TC",
    "https://www.gdacs.org/gdacsapi/api/events/geteventlist/EVENTS4APP",
]
KT = 1.852
# A storm whose latest advisory is older than this is over. NHC and JTWC advise
# every 6 hours, so a day without one means the storm was dropped.
STALE_HOURS = 24
# Words in an agency's text that mean the storm has ended (JTWC's last warning
# says "FINAL WARNING" or that the system dissipated or is no longer tropical).
ENDED = re.compile(
    r"FINAL WARNING|THIS IS THE FINAL|ISSUING THE FINAL|HAS DISSIPATED|HAVE DISSIPATED|DISSIPATED OVER|"
    r"NO LONGER (?:A )?(?:SIGNIFICANT )?TROPICAL|CEASED TO BE|WARNING (?:IS )?(?:CANCELLED|CANCELED)|"
    r"WARNINGS? (?:HAS|HAVE) BEEN CANCEL|REMNANT LOW|EXTRATROPICAL TRANSITION COMPLETE|HAS COMPLETED EXTRATROPICAL",
    re.I,
)
VERBOSE = "--verbose" in sys.argv


def log(*a):
    print(*a, file=sys.stderr)


def get(url, tries=3, timeout=60, binary=False):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                data = r.read()
                return data if binary else data.decode("utf-8", "replace")
        except Exception as e:  # noqa: BLE001 - retried, then reported
            last = e
            if i < tries - 1:
                time.sleep(5 * (i + 1))
    raise RuntimeError(f"{url}: {last}")


def sample(name, text, n=2500):
    if VERBOSE:
        log(f"----- {name} (first {n} chars) -----")
        log(text[:n])
        log("----- end -----")


def stale(at, hours=STALE_HOURS):
    """True when an ISO time like 2026-11-22T12:00Z is more than `hours` ago."""
    try:
        t = datetime.strptime(at, "%Y-%m-%dT%H:%MZ").replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return False
    return datetime.now(timezone.utc) - t > timedelta(hours=hours)


def now_z():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def latlon(lat, ns, lon, ew):
    la = float(lat) * (-1 if ns.upper() == "S" else 1)
    lo = float(lon) * (-1 if ew.upper() == "W" else 1)
    return round(la, 2), round(lo, 2)


def km(a, b):
    r = math.pi / 180
    h = math.sin((b[0] - a[0]) * r / 2) ** 2 + math.cos(a[0] * r) * math.cos(b[0] * r) * math.sin((b[1] - a[1]) * r / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def ddhhmm(s, ref):
    """'170000Z' or '17/0000Z' near ref (a UTC datetime) -> ISO string."""
    m = re.match(r"(\d\d)/?(\d\d)(\d\d)Z", s)
    if not m:
        return None
    d, hh, mm = int(m.group(1)), int(m.group(2)), int(m.group(3))
    best = None
    for months in (-1, 0, 1):
        y, mo = ref.year, ref.month + months
        if mo < 1:
            y, mo = y - 1, 12
        if mo > 12:
            y, mo = y + 1, 1
        try:
            t = datetime(y, mo, d, hh, mm, tzinfo=timezone.utc)
        except ValueError:
            continue
        if best is None or abs((t - ref).total_seconds()) < abs((best - ref).total_seconds()):
            best = t
    return best.strftime("%Y-%m-%dT%H:%MZ") if best else None


def pre_text(html):
    m = re.search(r"<pre[^>]*>(.*?)</pre>", html, re.S | re.I)
    return unescape(re.sub(r"<[^>]+>", "", m.group(1) if m else html))


def one_line(s):
    return re.sub(r"\s+", " ", s or "").strip()


# ---- NHC ----

NHC_TYPE = {
    "TD": "Tropical Depression",
    "STD": "Subtropical Depression",
    "TS": "Tropical Storm",
    "STS": "Subtropical Storm",
    "HU": "Hurricane",
    "MH": "Major Hurricane",
    "PTC": "Potential Tropical Cyclone",
    "PC": "Post-tropical Cyclone",
    "TY": "Typhoon",
}
NHC_BASIN = {"al": "Atlantic", "ep": "East Pacific", "cp": "Central Pacific"}


def saffir(kt):
    if kt is None:
        return None
    for lim, cat in ((137, 5), (113, 4), (96, 3), (83, 2), (64, 1)):
        if kt >= lim:
            return f"Category {cat}"
    return None


def nhc_forecast(text, ref):
    pts = []
    m = re.search(r"CENTER LOCATED NEAR\s+([\d.]+)([NS])\s+([\d.]+)([EW])\s+AT\s+(\d\d/\d{4}Z)", text)
    if m:
        la, lo = latlon(*m.group(1, 2, 3, 4))
        w = re.search(r"MAX SUSTAINED WINDS\s+(\d+)\s*KT", text)
        pts.append({"at": ddhhmm(m.group(5), ref), "lat": la, "lon": lo, "kt": int(w.group(1)) if w else None, "now": True})
    for mm in re.finditer(
        r"(?:FORECAST|OUTLOOK) VALID\s+(\d\d/\d{4}Z)\s+([\d.]+)([NS])\s+([\d.]+)([EW])([^\n]*)\n(?:[^\n]*\n)?\s*MAX WIND\s+(\d+)\s*KT",
        text,
    ):
        la, lo = latlon(*mm.group(2, 3, 4, 5))
        note = one_line(mm.group(6)).strip(". ")
        pts.append({"at": ddhhmm(mm.group(1), ref), "lat": la, "lon": lo, "kt": int(mm.group(7)), "note": note.title() or None})
    return pts


def nhc_public(text):
    out = {}
    m = re.search(r"\n\s*(\.\.\.[^\n]+(?:\n[^\n]+)*?\.\.\.)\s*\n", text)
    if m:
        out["headline"] = one_line(m.group(1)).strip(". ").capitalize()
    m = re.search(r"WATCHES AND WARNINGS\s*-+\s*(.+?)\n\s*\n(?:DISCUSSION|\$\$)", text, re.S)
    if m:
        out["warnings"] = one_line(m.group(1))[:1500]
    m = re.search(r"DISCUSSION AND OUTLOOK\s*-+\s*(.+?)(?:\n\s*\n\s*HAZARDS|\$\$)", text, re.S)
    if m:
        out["outlook"] = one_line(m.group(1))[:1500]
    m = re.search(r"HAZARDS AFFECTING LAND\s*-+\s*(.+?)(?:NEXT ADVISORY|\$\$)", text, re.S)
    if m:
        out["hazards"] = one_line(m.group(1))[:1500]
    return out


def nhc_storms(out_dir):
    storms = []
    raw = get(NHC)
    sample("NHC CurrentStorms.json", raw, 6000)
    data = json.loads(raw)
    log(f"NHC lists {len(data.get('activeStorms', []))} storms: " + ", ".join(f"{x.get('id')} {x.get('name')} {x.get('classification')} {x.get('lastUpdate')}" for x in data.get("activeStorms", [])))
    for s in data.get("activeStorms", []):
        sid = s.get("id", "").lower()
        try:
            ref = datetime.fromisoformat(s.get("lastUpdate", "").replace("Z", "+00:00"))
        except ValueError:
            ref = datetime.now(timezone.utc)
        if stale(ref.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%MZ")):
            log(f"NHC {sid}: last update {ref.isoformat()} is more than {STALE_HOURS} h old; left out")
            continue
        kt = int(s["intensity"]) if str(s.get("intensity", "")).isdigit() else None
        cls = s.get("classification", "")
        st = {
            "id": sid,
            "source": "nhc",
            "agency": "NOAA National Hurricane Center",
            "credit": "Courtesy: NOAA National Hurricane Center",
            "basin": NHC_BASIN.get(sid[:2], "Atlantic / Pacific"),
            "name": (s.get("name") or "").title(),
            "type": NHC_TYPE.get(cls, cls),
            "category": saffir(kt) if cls in ("HU", "MH") else None,
            "kt": kt,
            "hPa": int(s["pressure"]) if str(s.get("pressure", "")).isdigit() else None,
            "lat": s.get("latitudeNumeric"),
            "lon": s.get("longitudeNumeric"),
            "at": ref.strftime("%Y-%m-%dT%H:%MZ"),
            "movement": f"towards {s.get('movementDir')}° at {round(s['movementSpeed'] * 1.609)} km/h" if s.get("movementSpeed") is not None else None,
            "advisory": (s.get("publicAdvisory") or {}).get("advNum"),
            "links": {
                "advisory": (s.get("publicAdvisory") or {}).get("url"),
                "graphics": (s.get("forecastGraphics") or {}).get("url"),
            },
        }
        fa = (s.get("forecastAdvisory") or {}).get("url")
        if fa:
            try:
                t = pre_text(get(fa))
                sample(f"NHC forecast advisory {sid}", t)
                st["forecast"] = nhc_forecast(t, ref)
            except Exception as e:  # noqa: BLE001
                log(f"NHC forecast advisory {sid}: {e}")
        pa = st["links"]["advisory"]
        if pa:
            try:
                t = pre_text(get(pa))
                st.update(nhc_public(t))
            except Exception as e:  # noqa: BLE001
                log(f"NHC public advisory {sid}: {e}")
        bin_ = s.get("binNumber", "")
        m = re.match(r"([A-Z]{2})(\d+)", bin_)
        if m:
            url = f"https://www.nhc.noaa.gov/storm_graphics/{m.group(1)}{int(m.group(2)):02d}/{sid.upper()}_5day_cone_with_line_and_wind.png"
            st["picture"] = save_picture(url, out_dir, sid)
            st["links"]["picture"] = url
        storms.append(st)
    return storms


# ---- JTWC ----

JTWC_BASIN = {"wp": "West Pacific", "io": "North Indian Ocean", "sh": "Southern Hemisphere", "ep": "East Pacific", "cp": "Central Pacific"}


def jtwc_warning(text, sid):
    ref = datetime.now(timezone.utc)
    st = {"id": sid, "source": "jtwc", "agency": "Joint Typhoon Warning Center", "credit": "Courtesy: Joint Typhoon Warning Center"}
    st["basin"] = JTWC_BASIN.get(sid[:2], "")
    m = re.search(
        r"\b(SUPER TYPHOON|TYPHOON|TROPICAL STORM|TROPICAL DEPRESSION|TROPICAL CYCLONE|SUBTROPICAL STORM|HURRICANE|CYCLONE)\s+(\d{2}[A-Z])\s*(?:\(([^)]+)\))?\s+WARNING\s+NR\s*0*(\d+)",
        text,
    )
    if m:
        st["type"] = m.group(1).title()
        st["number"] = m.group(2)
        st["name"] = (m.group(3) or m.group(2)).title()
        st["advisory"] = m.group(4)
    m = re.search(r"WARNING POSITION:\s*(\d{6}Z)\s*-+\s*NEAR\s+([\d.]+)([NS])\s+([\d.]+)([EW])", text)
    pts = []
    if m:
        st["at"] = ddhhmm(m.group(1), ref)
        st["lat"], st["lon"] = latlon(*m.group(2, 3, 4, 5))
    m = re.search(r"MOVEMENT PAST (?:SIX|6) HOURS\s*-\s*(\d+)\s*DEGREES AT\s*(\d+)\s*KTS", text)
    if m:
        st["movement"] = f"towards {int(m.group(1))}° at {round(int(m.group(2)) * KT)} km/h"
    m = re.search(r"PRESENT WIND DISTRIBUTION:\s*MAX SUSTAINED WINDS\s*-\s*(\d+)\s*KT", text)
    if m:
        st["kt"] = int(m.group(1))
    if st.get("lat") is not None:
        pts.append({"at": st.get("at"), "lat": st["lat"], "lon": st["lon"], "kt": st.get("kt"), "now": True})
    for mm in re.finditer(
        r"(\d+)\s*HRS,\s*VALID AT:\s*(\d{6}Z)\s*-+\s*([\d.]+)([NS])\s+([\d.]+)([EW])(.*?)MAX SUSTAINED WINDS\s*-\s*(\d+)\s*KT",
        text,
        re.S,
    ):
        la, lo = latlon(*mm.group(3, 4, 5, 6))
        note = one_line(mm.group(7))
        note = "Over water" if "OVER WATER" in note else "Over land" if "INLAND" in note or "OVER LAND" in note else None
        pts.append({"at": ddhhmm(mm.group(2), ref), "lat": la, "lon": lo, "kt": int(mm.group(8)), "note": note})
    st["forecast"] = pts
    m = re.search(r"REMARKS:\s*(.+?)(?:\n\s*\d\.\s|\n\s*//|\Z)", text, re.S)
    if m:
        rem = one_line(m.group(1))
        rem = re.sub(r"\s*NEXT WARNINGS? AT .*$", "", rem)
        rem = re.sub(r"^\d{6}Z POSITION NEAR [\d.]+[NS] [\d.]+[EW]\.\s*\d+[A-Z]{3}\d+\.\s*", "", rem)
        st["outlook"] = rem.replace("//", "").replace("NNNN", "").strip()[:1500]
    if st.get("lon") is not None and sid[:2] == "sh":
        st["basin"] = "South Indian Ocean" if 20 <= st["lon"] < 135 else "South Pacific"
    m = re.search(r"MINIMUM CENTRAL PRESSURE AT \d{6}Z IS\s*(\d{3,4})\s*MB", text)
    if m:
        st["hPa"] = int(m.group(1))
    if st.get("kt") is not None and not st.get("category"):
        st["category"] = saffir(st["kt"])
    return st


def jtwc_storms(out_dir):
    raw = get(JTWC_RSS)
    sample("JTWC RSS", raw, 8000)
    text = unescape(raw)
    ids = []
    for sid in re.findall(r"/products/([a-z]{2}\d{4})web\.txt", text):
        if sid not in ids:
            ids.append(sid)
    storms = []
    for sid in ids:
        url = f"https://www.metoc.navy.mil/jtwc/products/{sid}web.txt"
        try:
            t = get(url)
        except RuntimeError as e:
            log(f"JTWC {sid}: {e}")
            continue
        sample(f"JTWC warning {sid}", t)
        st = jtwc_warning(t, sid)
        if st.get("lat") is None:
            log(f"JTWC {sid}: no position in the warning")
            continue
        if ENDED.search(t):
            log(f"JTWC {sid}: the warning says the storm has ended; left out")
            continue
        if stale(st.get("at")):
            log(f"JTWC {sid}: warning of {st.get('at')} is more than {STALE_HOURS} h old; left out")
            continue
        if st.get("kt") is not None and st["kt"] < 20:
            log(f"JTWC {sid}: winds {st['kt']} kt, too weak to list; left out")
            continue
        st["links"] = {"advisory": url}
        gif = f"https://www.metoc.navy.mil/jtwc/products/{sid}.gif"
        st["picture"] = save_picture(gif, out_dir, sid)
        st["links"]["picture"] = gif
        storms.append(st)
    return storms


# ---- GDACS ----

def gdacs_events():
    b = datetime.now(timezone.utc)
    a = b - timedelta(days=12)
    data, last = None, "no answer"
    for url in GDACS:
        try:
            raw = get(url.format(a=a.strftime("%Y-%m-%d"), b=b.strftime("%Y-%m-%d")), tries=2)
        except RuntimeError as e:
            last = str(e)
            continue
        sample("GDACS", raw)
        try:
            data = json.loads(raw)
            break
        except ValueError:
            last = f"{url.split('/')[-1][:30]} answered with something that is not JSON: {raw[:80]!r}"
    if data is None:
        raise RuntimeError(last)
    out = []
    for f in data.get("features", []):
        p = f.get("properties", {})
        cur = str(p.get("iscurrent", "")).lower() == "true"
        if p.get("eventtype") not in (None, "TC"):
            continue
        if not cur:
            continue
        # GDACS keeps "current" on for days after a storm ends.
        end = str(p.get("todate") or "")[:16]
        try:
            if datetime.now(timezone.utc) - datetime.strptime(end, "%Y-%m-%dT%H:%M").replace(tzinfo=timezone.utc) > timedelta(hours=STALE_HOURS):
                continue
        except ValueError:
            pass
        g = f.get("geometry") or {}
        lon, lat = (g.get("coordinates") or [None, None])[:2]
        countries = [c.get("countryname") for c in p.get("affectedcountries") or [] if c.get("countryname")]
        out.append(
            {
                "gdacsId": p.get("eventid"),
                "name": re.sub(r"^(Tropical Cyclone|Hurricane|Typhoon)\s+", "", p.get("name") or p.get("eventname") or "", flags=re.I).strip(),
                "alert": (p.get("alertlevel") or "").capitalize() or None,
                "severity": (p.get("severitydata") or {}).get("severitytext"),
                "countries": countries,
                "lat": lat,
                "lon": lon,
                "report": (p.get("url") or {}).get("report"),
            }
        )
    return out


# ---- pictures ----

def save_picture(url, out_dir, sid, width=1000):
    try:
        data = get(url, binary=True, tries=2)
    except RuntimeError as e:
        log(f"picture {sid}: {e}")
        return None
    try:
        from io import BytesIO

        from PIL import Image

        im = Image.open(BytesIO(data))
        im = im.convert("RGBA")
        bg = Image.new("RGB", im.size, "white")
        bg.paste(im, mask=im.split()[-1])
        bg.thumbnail((width, width * 3))
        os.makedirs(os.path.join(out_dir, "world"), exist_ok=True)
        name = f"world/{sid}.png"
        bg.save(os.path.join(out_dir, name), "PNG", optimize=True)
        return name
    except Exception as e:  # noqa: BLE001
        log(f"picture {sid}: not an image ({e})")
        return None


# ---- putting it together ----

def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 1:
        sys.exit(__doc__)
    out_dir = args[0]
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, "world.json")
    try:
        with open(path, encoding="utf-8") as f:
            old = json.load(f)
    except (OSError, ValueError):
        old = {}
    errors = {}
    storms = []
    for name, fn in (("nhc", nhc_storms), ("jtwc", jtwc_storms)):
        try:
            storms += fn(out_dir)
        except Exception as e:  # noqa: BLE001
            errors[name] = str(e)[:300]
            log(f"{name}: {e}")
    try:
        events = gdacs_events()
    except Exception as e:  # noqa: BLE001
        errors["gdacs"] = str(e)[:300]
        log(f"gdacs: {e}")
        events = []

    # JTWC also warns on NHC's storms (EP/CP); keep NHC's.
    kept = []
    for s in storms:
        dup = next((k for k in kept if k["source"] != s["source"] and k.get("lat") is not None and km((k["lat"], k["lon"]), (s["lat"], s["lon"])) < 250), None)
        if dup:
            continue
        kept.append(s)
    storms = kept

    # GDACS: alert and countries for the storm at the same place.
    for e in events:
        if e.get("lat") is None:
            continue
        near = min(storms, key=lambda s: km((s["lat"], s["lon"]), (e["lat"], e["lon"])), default=None)
        if near and km((near["lat"], near["lon"]), (e["lat"], e["lon"])) < 400:
            near["gdacs"] = {k: e[k] for k in ("alert", "severity", "countries", "report") if e.get(k)}
        else:
            storms.append(
                {
                    "id": f"gdacs{e['gdacsId']}",
                    "source": "gdacs",
                    "agency": "GDACS",
                    "credit": "Courtesy: GDACS",
                    "name": e["name"].title(),
                    "type": "Tropical cyclone",
                    "lat": e["lat"],
                    "lon": e["lon"],
                    "gdacs": {k: e[k] for k in ("alert", "severity", "countries", "report") if e.get(k)},
                    "forecast": [],
                    "links": {"advisory": e.get("report")},
                }
            )

    # Past positions, kept from run to run (a week at most).
    past = old.get("past", {})
    cutoff = (datetime.now(timezone.utc) - timedelta(days=10)).strftime("%Y-%m-%d")
    for s in storms:
        lst = [p for p in past.get(s["id"], []) if (p.get("at") or "") >= cutoff]
        if s.get("at") and s.get("lat") is not None and not any(p.get("at") == s["at"] for p in lst):
            lst.append({"at": s["at"], "lat": s["lat"], "lon": s["lon"], "kt": s.get("kt")})
        lst.sort(key=lambda p: p.get("at") or "")
        past[s["id"]] = lst
        s["past"] = lst
        if s.get("kt") is not None:
            s["kmh"] = round(s["kt"] * KT)
    live = {s["id"] for s in storms}
    past = {k: v for k, v in past.items() if k in live or (v and v[-1].get("at", "") >= cutoff)}

    # Pictures of storms that ended.
    pic_dir = os.path.join(out_dir, "world")
    if os.path.isdir(pic_dir):
        keep = {os.path.basename(s["picture"]) for s in storms if s.get("picture")}
        for f in os.listdir(pic_dir):
            if f not in keep:
                os.remove(os.path.join(pic_dir, f))

    out = {"readAt": now_z(), "storms": storms, "errors": errors, "past": past}
    same = {k: v for k, v in old.items() if k != "readAt"} == {k: v for k, v in out.items() if k != "readAt"}
    # Unchanged storms (or none, again) leave the file alone, so the data
    # branch isn't rewritten every hour for nothing.
    if not same:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
        print("world")
    for s in storms:
        log(f"{s['source']} {s['id']} {s.get('type')} {s.get('name')} {s.get('lat')},{s.get('lon')} {s.get('kt')} kt, {len(s.get('forecast', []))} forecast points, picture={bool(s.get('picture'))}, gdacs={s.get('gdacs', {}).get('alert')}")
    if errors:
        log("errors: " + json.dumps(errors))


if __name__ == "__main__":
    main()
