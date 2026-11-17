#!/usr/bin/env python3
"""Keeps every storm's past forecasts and observed positions for the app's
"Forecast vs what happened" panel (Cyclone watch).

    python3 scripts/cyclone_archive.py CYCLONE_DIR

Reads history.json (a compact line per IMD bulletin) and world.json (every
active storm worldwide) from CYCLONE_DIR and adds them to archive.json, which
the other scripts never trim, so a storm's forecasts outlive the storm.
Times are UTC, "YYYY-MM-DDTHH:MMZ"; positions are [time, lat, lon, km/h].
Prints "archive" when archive.json changed.
"""

import json
import os
import sys
from datetime import datetime, timedelta, timezone

KT = 1.852
KEEP_DAYS = 400
MAX_STORMS = 80
MAX_FORECASTS = 90
MAX_OBS = 400


def read(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def utc(s):
    if not s:
        return None
    try:
        d = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except ValueError:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%MZ")


def num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def new_storm(sid, source, agency, name, basin=None):
    return {"id": sid, "source": source, "agency": agency, "name": name or "", "basin": basin, "first": None, "last": None, "obs": [], "fc": []}


def add_obs(st, t, lat, lon, kmh):
    if not t or num(lat) is None or num(lon) is None:
        return
    row = [t, round(lat, 2), round(lon, 2), None if kmh is None else round(kmh)]
    for i, o in enumerate(st["obs"]):
        if o[0] == t:
            st["obs"][i] = row
            return
    st["obs"].append(row)


def add_fc(st, issued, base, no, pts):
    pts = [p for p in pts if p[0] and base and p[0] > base]
    if not issued or not base or not pts:
        return
    if any(f["issued"] == issued and f.get("no") == no for f in st["fc"]):
        return
    st["fc"].append({"issued": issued, "base": base, "no": no, "pts": pts})


def from_imd(storms, hist):
    by = {}
    for h in hist.get("bulletins", []):
        if h.get("system"):
            by.setdefault(h["system"], []).append(h)
    for system, rows in by.items():
        sid = "imd:" + system
        st = storms.setdefault(sid, new_storm(sid, "imd", "India Meteorological Department", None, "North Indian Ocean"))
        names = [r["name"] for r in rows if r.get("name")]
        if names:
            st["name"] = names[-1]
        for h in sorted(rows, key=lambda r: r.get("issued") or ""):
            fc = [[utc(r[0]), r[1], r[2], r[3]] for r in h.get("forecast", []) if len(r) >= 3 and utc(r[0])]
            if not fc:
                continue
            fc.sort(key=lambda r: r[0])
            first = fc[0]
            # The table's first row is the current position: an observation.
            add_obs(st, first[0], first[1], first[2], first[3])
            add_fc(st, utc(h.get("issued")), first[0], h.get("no"), fc[1:])


def from_world(storms, world):
    for s in world.get("storms", []):
        sid = s["id"]
        st = storms.setdefault(sid, new_storm(sid, s.get("source"), s.get("agency"), s.get("name"), s.get("basin")))
        st["name"] = s.get("name") or st["name"]
        st["agency"] = s.get("agency") or st["agency"]
        for p in world.get("past", {}).get(sid, []):
            add_obs(st, utc(p.get("at")), p.get("lat"), p.get("lon"), None if p.get("kt") is None else p["kt"] * KT)
        base = utc(s.get("at"))
        add_obs(st, base, s.get("lat"), s.get("lon"), None if s.get("kt") is None else s["kt"] * KT)
        pts = []
        for r in s.get("forecast") or []:
            t = utc(r.get("at"))
            if t and num(r.get("lat")) is not None and num(r.get("lon")) is not None and not r.get("now"):
                pts.append([t, round(r["lat"], 2), round(r["lon"], 2), None if r.get("kt") is None else round(r["kt"] * KT)])
        add_fc(st, base, base, s.get("advisory"), pts)


def tidy(storms):
    cutoff = (datetime.now(timezone.utc) - timedelta(days=KEEP_DAYS)).strftime("%Y-%m-%dT%H:%MZ")
    for sid in list(storms):
        st = storms[sid]
        st["obs"] = sorted(st["obs"], key=lambda o: o[0])[-MAX_OBS:]
        st["fc"] = sorted(st["fc"], key=lambda f: f["issued"])[-MAX_FORECASTS:]
        times = [o[0] for o in st["obs"]] + [f["issued"] for f in st["fc"]]
        if not times:
            del storms[sid]
            continue
        st["first"], st["last"] = min(times), max(times)
        if st["last"] < cutoff:
            del storms[sid]
    keep = sorted(storms.values(), key=lambda s: s["last"], reverse=True)[:MAX_STORMS]
    return {s["id"]: s for s in keep}


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    out = sys.argv[1]
    path = os.path.join(out, "archive.json")
    old = read(path, {})
    storms = old.get("storms", {})
    from_imd(storms, read(os.path.join(out, "history.json"), {}))
    from_world(storms, read(os.path.join(out, "world.json"), {}))
    new = {"storms": tidy(storms)}
    if {"storms": old.get("storms", {})} == new:
        return
    new["updated"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(new, f, ensure_ascii=False, separators=(",", ":"))
    print("archive")


if __name__ == "__main__":
    main()
