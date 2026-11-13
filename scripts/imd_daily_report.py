#!/usr/bin/env python3
"""Turns IMD Chennai's Daily Weather Report (a PDF) into JSON for the app.

    python3 scripts/imd_daily_report.py report.pdf OUT_DIR

RMC Chennai publishes the report every afternoon at
https://mausam.imd.gov.in/chennai/mcdata/daily_weather_report.pdf (about
6 MB, mostly map pictures). Its first pages are text tables, which
pdfplumber reads cell by cell:

  - the summary (rain distribution, highest rain, hottest and coolest places),
  - the temperature change and departure tables,
  - the synoptic features and the 7-day rain forecast,
  - the local forecast for Chennai,
  - Nungambakkam and Meenambakkam's figures,
  - the station table (max/min and departures, humidity, rain, season, year),
  - the chief amounts of rainfall by district,
  - the district table (the day and the season against normal).

Tables are found by their headings, not by page number, so a page added or
dropped does not matter. The pictures on the map pages are saved as JPEG.

Writes into OUT_DIR:
  latest.json            today's report
  YYYY-MM-DD.json        the same, by date
  history.json           a compact line per date (stations, Chennai, districts)
  maps/N.jpg             the report's maps and graph, latest only
Prints the report date. Exits 2 if the PDF is not a daily report.
"""

import json
import os
import re
import subprocess
import sys
from datetime import date, datetime, timezone

import pdfplumber

SOURCE = "https://mausam.imd.gov.in/chennai/mcdata/daily_weather_report.pdf"
HISTORY_DAYS = 400

# What the report's map pictures show, in the order they come (Nov 2026). Used
# only when the count matches; otherwise they are called "Map 1", "Map 2", …
MAP_TITLES = [
    "Rain this season against normal",
    "Rain this season, day by day",
    "Rain in the past 24 hours",
    "Max temperature",
    "Min temperature",
] + [f"Rain forecast, day {d}" for d in range(1, 8)]
MAP_WIDTH = 1100


def clean(s):
    if s is None:
        return ""
    return re.sub(r"\s+", " ", str(s)).strip()


def num(s):
    """A number, or None for '--', 'NA', '' and the like."""
    s = clean(s).replace("–", "-").replace("−", "-")
    m = re.fullmatch(r"[+-]?\d+(?:\.\d+)?", s)
    return float(s) if m else None


def ddmmyyyy(s):
    m = re.search(r"(\d{1,2})[-./](\d{1,2})[-./](\d{4})", s or "")
    if not m:
        return None
    return date(int(m[3]), int(m[2]), int(m[1])).isoformat()


def placeholder(s):
    return not clean(s) or re.fullmatch(r"[-–\s]+", clean(s)) is not None


# --------------------------------------------------------------- the pages


def read_pdf(path):
    pages = []
    with pdfplumber.open(path) as pdf:
        for p in pdf.pages:
            pages.append({"text": p.extract_text() or "", "tables": p.extract_tables()})
    return pages


def all_tables(pages):
    for i, p in enumerate(pages):
        for t in p["tables"]:
            yield i, t


def find_table(pages, pattern):
    """The first table whose first cells match pattern."""
    rx = re.compile(pattern, re.I)
    for _, t in all_tables(pages):
        head = " ".join(clean(c) for r in t[:3] for c in r if c)
        if rx.search(head):
            return t
    return None


# ----------------------------------------------------------------- summary


def summary(text):
    out = {}
    m = re.search(r"DATE:\s*(\d{1,2})\w*\s+([A-Za-z]+)\s+(\d{4})", text)
    if m:
        out["date"] = datetime.strptime(f"{m[1]} {m[2]} {m[3]}", "%d %B %Y").date().isoformat()
    m = re.search(r"Time of issue:\s*([0-9]{3,4})\s*Hrs", text, re.I)
    if m:
        out["issued"] = m[1].zfill(4)

    m = re.search(r"Rainfall Distribution\s*(.+?)Highest amount", text, re.S | re.I)
    if m:
        out["rainfall"] = clean(m[1])
    m = re.search(r"Highest amount of rainfall:\s*[–-]?\s*(.+?)\s*\((.+?)\s+district\)\s*[–-]\s*([\d.]+)\s*mm", text, re.I)
    if m:
        out["highestRain"] = {"place": clean(m[1]), "district": clean(m[2]), "mm": float(m[3])}
    elif re.search(r"Highest amount of rainfall:\s*[–-]?\s*(nil|-+)", text, re.I):
        out["highestRain"] = None

    m = re.search(r"Maximum Temperature:\s*Tendency:\s*(.+?)Departure from normal:\s*(.+?)(?=\n\s*\S+\s+recorded)", text, re.S | re.I)
    if m:
        out["maxTendency"] = clean(m[1])
        out["maxDeparture"] = clean(m[2])
    extremes = []
    for m in re.finditer(r"^(.+?) recorded the (highest maximum|lowest minimum) temperature of ([\d.]+)\s*°?\s*C\s*(?:over|in)\s+(?:the\s+)?(.+?)\.?$", text, re.M | re.I):
        extremes.append({
            "places": clean(m[1]),
            "what": "max" if m[2].lower().startswith("highest") else "min",
            "value": float(m[3]),
            "where": clean(m[4]),
        })
    # A line may wrap ("…in the plains of Tamil\nNadu."): read the whole sentence.
    for m in re.finditer(r"(\S[^\n]*?) recorded the (highest maximum|lowest minimum) temperature of ([\d.]+)\s*°?\s*C\s+(?:over|in)\s+(?:the\s+)?(.+?)\.", text, re.S | re.I):
        places, where = clean(m[1]), clean(m[4])
        e = next((x for x in extremes if x["places"] == places and x["value"] == float(m[3])), None)
        if e:
            e["where"] = where
    out["extremes"] = extremes
    return out


def change_tables(pages):
    """The four 'MAXIMUM/MINIMUM TEMPERATURE (24 HOURS CHANGE / DEPARTURE)' tables."""
    out = {}
    for _, t in all_tables(pages):
        head = clean(t[0][0]) if t and t[0] else ""
        m = re.match(r"(MAXIMUM|MINIMUM) TEMPERATURE \((24 HOURS CHANGE|DEPARTURE)\)", head, re.I)
        if not m:
            continue
        key = ("max" if m[1].upper() == "MAXIMUM" else "min") + ("Change" if "CHANGE" in m[2].upper() else "Departure")
        rows = []
        for r in t[1:]:
            label, where = clean(r[0]), clean(r[-1] if len(r) > 1 else "")
            if label and not placeholder(where):
                rows.append({"label": label, "where": re.sub(r"^Over\s+", "", where).rstrip(".")})
        out[key] = rows
    return out


def synoptic(text):
    m = re.search(r"SYNOPTIC METEOROLOGICAL FEATURES?:?\s*(.+?)\n\s*III\)", text, re.S | re.I)
    if not m:
        return []
    paras = re.split(r"\n\s*\n|(?<=\.)\n(?=Yesterday|Today|It is|The |A |An )", m[1])
    return [clean(p) for p in paras if clean(p)]


def forecast(pages, text):
    days = []
    for _, t in all_tables(pages):
        for r in t:
            cells = [c for c in r if c is not None]
            label = next((c for c in cells if re.match(r"\s*Day\s*\d", c or "")), None)
            body = [c for c in cells if c and c is not label and len(clean(c)) > 20]
            if label and body and "Temperature" not in " ".join(clean(c) for c in cells[:1]):
                nums = [int(x) for x in re.findall(r"Day\s*(\d)", label)]
                dates = [ddmmyyyy(x) for x in re.findall(r"\(([\d.]+)\)", label)]
                lines = [clean(x) for x in re.split(r"(?<=\.)\s*\n", body[0]) if clean(x)]
                if nums and not any(d["days"] == nums for d in days):
                    days.append({"days": nums, "dates": dates, "text": lines})
    days.sort(key=lambda d: d["days"][0])
    temp = ""
    t = find_table(pages, r"^MAXIMUM TEMPERATURE FORECAST")
    if t and len(t) > 1:
        temp = clean(t[1][0])
    return {"days": days, "maxTemp": temp}


def chennai_forecast(pages):
    t = find_table(pages, r"LOCAL FORECAST FOR CHENNAI")
    if not t:
        return None
    heads = []
    for r in t[1:3]:
        for c in r:
            if c and re.match(r"Day\s*\d", c):
                heads.append({"label": clean(c), "date": ddmmyyyy(c)})
    if not heads:
        return None
    days = [dict(h) for h in heads]
    keys = {"Maximum Temperature": "max", "Minimum Temperature": "min", "Sky Condition": "sky", "Weather": "weather", "24 Hour Rainfall": "rain"}
    last = None
    for r in t[2:]:
        label = clean(r[0])
        vals = [clean(c) for c in r[1:] if c not in (None,)]
        vals = [v for v in vals if v]
        key = keys.get(label)
        if key:
            last = key
        elif r[0] is None and last:
            key = last  # a wrapped cell's second line
        else:
            continue
        # Cells sit under Day 1 then Day 2; when there are fewer values than
        # days, the first ones belong to the earlier day.
        for i, v in enumerate(vals[: len(days)]):
            d = days[i]
            d[key] = clean(f"{d.get(key, '')} {v}") if r[0] is None else v
    for d in days:
        for k in ("max", "min"):
            m = re.match(r"(\d+)\s*-\s*(\d+)", d.get(k, ""))
            if m:
                d[k + "Range"] = [int(m[1]), int(m[2])]
    return {"days": days}


def chennai_table(pages):
    """The CHN (N) / CHN (AP) table, read cell by cell."""
    t = find_table(pages, r"TEMPERATURE.*CHN")
    if not t:
        return None
    # Each value row sits just above or beside its label row; walk the rows and
    # attach every value pair to the next label in that column group.
    groups = [(0, 1, 2), (3, 4, 5), (6, 7, 8)]
    labels = {0: [], 3: [], 6: []}
    values = {0: [], 3: [], 6: []}
    for ri, r in enumerate(t):
        for g in groups:
            if len(r) <= g[2]:
                continue
            lab = clean(r[g[0]])
            a, b = r[g[1]], r[g[2]]
            if lab and not re.match(r"(TEMPERATURE|\(Degree|RELATIVE|HUMIDITY|RAINFALL|\(mm\))", lab, re.I):
                labels[g[0]].append((ri, lab))
            if a is not None and clean(a) != "" and re.fullmatch(r"-?[\d.]+|NA|--", clean(a)):
                values[g[0]].append((ri, num(a), num(b)))
    out = {"N": {}, "AP": {}}

    def assign(col, names):
        # Values and labels come in the same order down the column.
        vals = values[col]
        for k, name in enumerate(names):
            if k < len(vals):
                out["N"][name] = vals[k][1]
                out["AP"][name] = vals[k][2]

    assign(0, ["max", "maxDep", "min", "minDep", "t0830"])
    assign(3, ["rh0830", "rh0830Dep", "rh1730", "rh1730Dep"])
    assign(6, ["rain24", "season", "seasonDep"])
    flat = " ".join(clean(c) for r in t for c in r if c)
    m = re.search(r"Since\s*([\d.]+)", flat)
    out["seasonFrom"] = ddmmyyyy(m[1]) if m else None
    m = re.search(r"1730 hrs\.? IST on.{0,80}?(\d{1,2}\.\d{1,2}\.\d{4})", flat, re.I)
    out["rh1730Date"] = ddmmyyyy(m[1]) if m else None
    return out


def stations(pages):
    t = find_table(pages, r"OBSERVATIONS RECORDED AT 0830")
    if not t:
        return [], None
    head = clean(t[0][0])
    obs_date = ddmmyyyy(head)
    rows = []
    for r in t:
        name = clean(r[0])
        if len(r) < 12 or not name or name.lower() in ("stations",) or name.startswith("*"):
            continue
        if num(r[1]) is None and num(r[3]) is None and num(r[7]) is None:
            continue
        rows.append({
            "name": name,
            "max": num(r[1]), "maxDep": num(r[2]),
            "min": num(r[3]), "minDep": num(r[4]),
            "rh": num(r[5]), "rhDep": num(r[6]),
            "rain": num(r[7]), "season": num(r[8]), "seasonDep": num(r[9]),
            "yearCm": num(r[10]), "normalCm": num(r[11]),
            "weather": clean(r[12]) if len(r) > 12 else "",
        })
    return rows, obs_date


def chief_rain(pages):
    t = find_table(pages, r"^District\s+Spatial")
    out = []
    if not t:
        return out
    for r in t[1:]:
        if len(r) < 3 or not clean(r[0]):
            continue
        places = [{"name": clean(m[1]), "cm": float(m[2])} for m in re.finditer(r"([^;]+?)\s+([\d.]+)\s*;", clean(r[2]) + ";")]
        out.append({
            "district": clean(r[0]),
            "spatial": clean(r[1]),
            "places": places,
            "note": "" if places else clean(r[2]),
        })
    return out


def districts(pages):
    """The district table, which may run over two pages."""
    rows = []
    day = period = None
    started = False
    for _, t in all_tables(pages):
        flat = " ".join(clean(c) for r in t[:2] for c in r if c)
        if "DISTRICT DETAILS" in flat:
            started = True
            m = re.search(r"DAY:\s*([\d-]+)\s*to\s*([\d-]+)", flat)
            day = [ddmmyyyy(m[1]), ddmmyyyy(m[2])] if m else None
            m = re.search(r"PERIOD:\s*([\d-]+)\s*to\s*([\d-]+)", flat)
            period = [ddmmyyyy(m[1]), ddmmyyyy(m[2])] if m else None
        elif not started:
            continue
        hit = False
        for r in t:
            if len(r) < 10:
                continue
            name = clean(r[1])
            if not name or name.upper() == "DISTRICT" or num(r[2]) is None and num(r[6]) is None:
                continue
            hit = True
            rows.append({
                "name": name.title(),
                "total": not clean(r[0]),
                "day": {"actual": num(r[2]), "normal": num(r[3]), "dep": num(r[4]), "cat": clean(r[5])},
                "season": {"actual": num(r[6]), "normal": num(r[7]), "dep": num(r[8]), "cat": clean(r[9])},
            })
        if started and not hit and rows:
            break
    return {"day": day, "period": period, "rows": rows}


# --------------------------------------------------------------- maps


def map_pages(path, pages, out_dir):
    """The pictures on the pages with (almost) no text after the district
    table: the maps and the season graph. Taken out of the PDF as they are
    (not the whole page, which is mostly IMD's watermark) and saved as JPEG."""
    from tempfile import TemporaryDirectory

    from PIL import Image

    first = next((i for i, p in enumerate(pages) if "DISTRICT DETAILS" in p["text"]), 0)
    idx = [i for i, p in enumerate(pages) if i > first and len(p["text"].strip()) < 40]
    mdir = os.path.join(out_dir, "maps")
    os.makedirs(mdir, exist_ok=True)
    for f in os.listdir(mdir):
        os.remove(os.path.join(mdir, f))
    pictures = []
    with TemporaryDirectory() as tmp:
        for i in idx:
            prefix = os.path.join(tmp, f"p{i + 1:03d}")
            subprocess.run(["pdfimages", "-f", str(i + 1), "-l", str(i + 1), "-png", path, prefix], check=True)
            for f in sorted(x for x in os.listdir(tmp) if x.startswith(os.path.basename(prefix))):
                with Image.open(os.path.join(tmp, f)) as im:
                    # Leave out the watermark (600 × 1050), masks and small logos.
                    if im.mode in ("L", "1", "LA") or im.width < 800:
                        continue
                    im = im.convert("RGB")
                    if im.width > MAP_WIDTH:
                        im = im.resize((MAP_WIDTH, round(im.height * MAP_WIDTH / im.width)), Image.LANCZOS)
                    pictures.append(im.copy())
    titles = MAP_TITLES if len(pictures) == len(MAP_TITLES) else [f"Map {k + 1}" for k in range(len(pictures))]
    maps = []
    for k, im in enumerate(pictures):
        im.save(os.path.join(mdir, f"{k + 1}.jpg"), "JPEG", quality=76, optimize=True)
        maps.append({"title": titles[k], "src": f"maps/{k + 1}.jpg", "width": im.width, "height": im.height})
    return maps


# --------------------------------------------------------------- main


def parse(path):
    pages = read_pdf(path)
    text = "\n".join(p["text"] for p in pages)
    s = summary(pages[0]["text"] + "\n" + (pages[1]["text"] if len(pages) > 1 else ""))
    st, obs_date = stations(pages)
    report = {
        "date": s.pop("date", None) or obs_date,
        "issued": s.pop("issued", None),
        "source": SOURCE,
        "summary": s,
        "temperatureTables": change_tables(pages),
        "synoptic": synoptic(text),
        "forecast": forecast(pages, text),
        "chennaiForecast": chennai_forecast(pages),
        "chennai": chennai_table(pages),
        "stations": st,
        "chiefRain": chief_rain(pages),
        "districts": districts(pages),
    }
    return pages, report


def compact(r):
    """One history line: what the charts over days need."""
    return {
        "date": r["date"],
        "chennai": r.get("chennai"),
        "stations": {s["name"]: [s["max"], s["min"], s["rain"], s["season"]] for s in r["stations"]},
        "districts": {d["name"]: [d["day"]["actual"], d["season"]["actual"], d["season"]["normal"]] for d in r["districts"]["rows"]},
        "highestRain": r["summary"].get("highestRain"),
    }


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    path, out_dir = sys.argv[1], sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    pages, report = parse(path)
    if not report["date"] or not report["stations"]:
        print("Not a daily weather report (no date or station table)", file=sys.stderr)
        sys.exit(2)
    report["maps"] = map_pages(path, pages, out_dir)
    report["readAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    def dump(name, obj):
        with open(os.path.join(out_dir, name), "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))

    dump("latest.json", report)
    dump(f"{report['date']}.json", report)

    hist_path = os.path.join(out_dir, "history.json")
    try:
        with open(hist_path, encoding="utf-8") as f:
            hist = json.load(f)
    except (OSError, ValueError):
        hist = {"days": []}
    days = [d for d in hist.get("days", []) if d.get("date") != report["date"]]
    days.append(compact(report))
    days.sort(key=lambda d: d["date"])
    dump("history.json", {"days": days[-HISTORY_DAYS:]})
    print(report["date"])


if __name__ == "__main__":
    main()
