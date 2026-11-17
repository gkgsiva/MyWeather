#!/usr/bin/env python3
"""Reads IMD's latest cyclone bulletin and the MJO index into JSON for the
app's "Cyclone watch" screen.

    python3 scripts/imd_cyclone.py OUT_DIR [--force]

IMD's Cyclone Information page (mausam.imd.gov.in/responsive/
cycloneinformation.php) links the newest National Bulletin, a PDF of 3-4 MB
(mostly pictures) issued every 3-6 hours while a depression or cyclone is
active. Its first pages are text: the system's name and stage, where it is and
how far from the coast's cities, where IMD expects it to cross the coast, the
forecast table (position, wind, stage every 6-12 hours) and the warnings
(rain, wind, sea, storm surge) by state. pdftotext reads them; phones then
download a few kilobytes instead of the PDF.

Writes into OUT_DIR (the `data` branch's cyclone/ folder):
  latest.json    the newest bulletin, read
  history.json   a compact line per bulletin (landfall text, forecast track)
  track.jpg      IMD's "Track of Cyclonic Disturbance" picture (with the cone)
  mjo.json       the last 60 days of the BoM RMM MJO index (refreshed daily)

A bulletin already read (same PDF address) is not read again. Prints what
changed ("bulletin", "track", "mjo"), one per line; nothing when nothing did.
Exits 1 when IMD's page can't be read.
"""

import json
import math
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.request
from datetime import datetime, timedelta, timezone

PAGE = "https://mausam.imd.gov.in/responsive/cycloneinformation.php"
MJO_URLS = [
    "https://www.bom.gov.au/clim_data/IDCKGEM000/rmm.74toRealtime.txt",
    "http://www.bom.gov.au/clim_data/IDCKGEM000/rmm.74toRealtime.txt",
    "https://www.bom.gov.au/climate/mjo/graphics/rmm.74toRealtime.txt",
]
UA = "Mozilla/5.0 (Linux; Android 14) MyWeather cyclone reader"
IST = timezone(timedelta(hours=5, minutes=30))
HISTORY = 120
MJO_DAYS = 60

STAGES = [
    "Super Cyclonic Storm",
    "Extremely Severe Cyclonic Storm",
    "Very Severe Cyclonic Storm",
    "Severe Cyclonic Storm",
    "Cyclonic Storm",
    "Deep Depression",
    "Depression",
    "Well Marked Low Pressure Area",
    "Low Pressure Area",
]
STAGE_RE = "|".join(STAGES)


def get(url, tries=4, timeout=90):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001 - any network failure retries
            last = e
            if i < tries - 1:
                time.sleep(10 * (i + 1))
    raise RuntimeError(f"{url}: {last}")


def page_links(html):
    """[(kind, title, url)] from openPDF("Title", "url") / openImage(...)."""
    out = []
    for kind, title, url in re.findall(r'open(PDF|Image)\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)', html):
        out.append((kind, title.strip(), url.strip()))
    return out


def one_line(s):
    # pdftotext breaks "south-\nsoutheast" into "south- southeast".
    return re.sub(r"(?<=[a-z])-\s+(?=[a-z])", "-", re.sub(r"\s+", " ", s or "")).strip()


def iso(d, hhmm):
    return d.replace(hour=int(hhmm[:2]), minute=int(hhmm[2:]), tzinfo=IST).isoformat(timespec="minutes")


def stage_of(s):
    m = re.search(STAGE_RE, s or "", re.I)
    if not m:
        return None
    return next(x for x in STAGES if x.lower() == m.group(0).lower())


def wind(s):
    """'65-75 gusting to 85' -> {min, max, gust} in km/h."""
    m = re.search(r"(\d+)\s*-\s*(\d+)\s*(?:kmph)?\s*gusting\s*(?:to\s*)?(\d+)", s or "", re.I)
    if m:
        return {"min": int(m.group(1)), "max": int(m.group(2)), "gust": int(m.group(3))}
    m = re.search(r"(\d+)\s*-\s*(\d+)", s or "")
    return {"min": int(m.group(1)), "max": int(m.group(2)), "gust": None} if m else None


def sentences(text):
    # A full stop ends a sentence unless a digit follows it (12.2°N, 0.5 m).
    return [s.strip() for s in re.split(r"(?<=\.)\s+(?=[A-Z(])", text) if s.strip()]


def parse_bulletin(text):
    text = text.replace("\f", "\n")
    b = {}
    m = re.search(r"NATIONAL\s+BULLETIN\s+NO\.?\s*(\d+)\s*(?:\(([^)]+)\))?", text, re.I)
    b["no"] = int(m.group(1)) if m else None
    b["system"] = one_line(m.group(2)) if m and m.group(2) else None
    m = re.search(r"TIME\s+OF\s+ISSUE\s*:?\s*(\d{4})\s*HOURS\s*IST.*?DATED\s*:?\s*(\d{1,2})[./](\d{1,2})[./](\d{4})", text, re.I | re.S)
    issued = None
    if m:
        issued = datetime(int(m.group(4)), int(m.group(3)), int(m.group(2)))
        b["issued"] = iso(issued, m.group(1))

    m = re.search(r"\bSub\s*:\s*(.+?)\n\s*\n", text, re.S)
    subject = one_line(m.group(1)) if m else ""
    b["subject"] = subject
    m = re.search(r"[“\"]([A-Za-z][A-Za-z\- ]{1,20})[”\"]", subject)
    b["name"] = m.group(1).strip() if m else None
    b["stage"] = stage_of(subject)
    m = re.search(r"\[([^\]]*(?:Alert|Warning|Watch|Message)[^\]]*)\]", subject, re.I)
    b["alert"] = one_line(m.group(1)) if m else None
    m = re.search(r"\b(Red|Orange|Yellow)\s+Message", subject, re.I)
    b["colour"] = m.group(1).capitalize() if m else None

    # The story: paragraphs after the subject, up to the forecast table.
    sub = re.search(r"\bSub\s*:.+?\n\s*\n", text, re.S)
    body = text[sub.end() :] if sub else text
    end = re.search(r"Forecast\s+(?:track|location)|Warnings\s*:|Date/Time", body, re.I)
    story = body[: end.start()] if end else body[:3000]
    paras = [one_line(p) for p in re.split(r"\n\s*\n", story) if one_line(p)]
    b["paragraphs"] = paras[:8]

    whole = " ".join(paras)
    m = re.search(r"Latitude\s*([\d.]+)\s*°?\s*N\s*and\s*Longitude\s*([\d.]+)\s*°?\s*E", whole, re.I)
    if m:
        b["lat"], b["lon"] = float(m.group(1)), float(m.group(2))
    m = re.search(r"at\s+(\d{4})\s*hours?\s+IST\s+of\s+(?:today|yesterday)", whole, re.I)
    if m and issued:
        at = issued - timedelta(days=1) if "yesterday" in m.group(0).lower() else issued
        b["at"] = iso(at, m.group(1))
    b["distances"] = [
        {"km": int(km), "dir": one_line(d), "place": one_line(p), "region": one_line(r)}
        for km, d, p, r in re.findall(
            r"(?:about\s+)?(\d{2,4})\s*km\s+([a-z\-]+)\s+of\s+([A-Z][A-Za-z .'\-]+?)\s*\(([^)]+)\)", whole
        )
    ]
    m = re.search(r"\b(moved|remained|intensified|weakened|lay)\b[^.]*?\bpast\s+\d+\s*hours?", whole, re.I)
    b["movement"] = m.group(0) if m else None

    land = next((s for s in sentences(whole) if re.search(r"\bcross\b", s, re.I)), None)
    if land:
        lf = {"text": land}
        m = re.search(r"cross(?:ing)?\s+(?:the\s+)?(.+?)\s+coasts?\b", land, re.I)
        if m:
            lf["coast"] = one_line(m.group(1))
        m = re.search(r"between\s+([A-Z][A-Za-z .'\-]+?)\s+and\s+([A-Z][A-Za-z .'\-]+?)(?=[,(]|\s+(?:around|during|by|on|as|close|near|in)\b)", land)
        if m:
            lf["between"] = [m.group(1).strip(), m.group(2).strip()]
        else:
            m = re.search(r"(?:near|close to|over)\s+([A-Z][A-Za-z .'\-]+?)(?=[,(]|\s+(?:around|during|by|on|as)\b)", land)
            if m:
                lf["near"] = m.group(1).strip()
        m = re.search(r"(?:around|during|by)\s+((?:early hours|morning|forenoon|noon|afternoon|evening|night|midnight)[^,]*?(?:of\s+)?\d{1,2}(?:st|nd|rd|th)?\s+[A-Z][a-z]+(?:,?\s*\d{4})?)", land)
        if m:
            lf["when"] = one_line(m.group(1))
        lf["stage"] = stage_of(land)
        w = wind(land)
        if w:
            lf["wind"] = w
        b["landfall"] = lf

    track = []
    for dd, mm, yy, hhmm, lat, lon, rest in re.findall(
        r"^\s*(\d{1,2})\.(\d{1,2})\.(\d{2,4})\s*/\s*(\d{4})\s+([\d.]+)\s*/\s*([\d.]+)\s+(.+)$", text, re.M
    ):
        year = int(yy) + (2000 if len(yy) == 2 else 0)
        row = {"at": iso(datetime(year, int(mm), int(dd)), hhmm), "lat": float(lat), "lon": float(lon)}
        row["wind"] = wind(rest)
        row["stage"] = stage_of(rest)
        track.append(row)
    b["forecast"] = track

    b["warnings"] = warnings(text)
    return b


def warnings(text):
    """{rain|wind|sea|surge: [{region, text}]} from the Warnings section."""
    m = re.search(r"\bWarnings?\s*:\s*\n(.+?)(?:\(v\)|Impact\s+Expected|Fisherm[ae]n\s+warning)", text, re.S | re.I)
    if not m:
        return {}
    sec = m.group(1)
    keys = {"rain": r"Rain", "wind": r"Wind", "sea": r"Sea\s+condition", "surge": r"Storm\s+Surge"}
    parts = re.split(r"^\s*\((?:i|ii|iii|iv|v|vi)\)\s*", sec, flags=re.M)
    out = {}
    for p in parts:
        head = p.split("\n", 1)[0]
        key = next((k for k, rx in keys.items() if re.match(rx, head.strip(), re.I)), None)
        if not key:
            continue
        rest = p.split("\n", 1)[1] if "\n" in p else ""
        items = re.split(r"\n(?=[A-Z][A-Za-z&,.'\-/ ]{2,90}:\s)", "\n" + rest)
        rows = []
        for it in items:
            it = one_line(it)
            if not it or "•" in it[:3]:
                continue
            mm = re.match(r"([A-Z][A-Za-z&,.'\-/ ]{2,90}):\s*(.+)", it)
            rows.append({"region": mm.group(1).strip(), "text": mm.group(2)} if mm else {"region": "", "text": it})
        out[key] = rows
    return out


def pdf_text(path, last_page=5):
    return subprocess.run(
        ["pdftotext", "-layout", "-l", str(last_page), path, "-"], check=True, capture_output=True, text=True
    ).stdout


def save_picture(data, path, width=1100):
    """IMD's PNG is 2300 px and 5 MB; phones get a 1100 px JPEG (~200 KB)."""
    from io import BytesIO

    from PIL import Image

    im = Image.open(BytesIO(data))
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        bg = Image.new("RGB", im.size, "white")
        bg.paste(im, mask=im.split()[-1])
        im = bg
    im.thumbnail((width, width * 4))
    im.save(path, "JPEG", quality=82, optimize=True)


def read_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def dump(path, obj):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))


def compact(b):
    return {
        "no": b.get("no"),
        "system": b.get("system"),
        "issued": b.get("issued"),
        "name": b.get("name"),
        "stage": b.get("stage"),
        "lat": b.get("lat"),
        "lon": b.get("lon"),
        "landfall": {k: v for k, v in (b.get("landfall") or {}).items() if k in ("text", "between", "near", "when", "coast")},
        "forecast": [[r["at"], r["lat"], r["lon"], (r.get("wind") or {}).get("max")] for r in b.get("forecast", [])],
    }


# ---- MJO (Bureau of Meteorology's real-time RMM index) ----

def phase_of(r1, r2):
    a = math.degrees(math.atan2(r2, r1))
    return int((a + 180) // 45) % 8 + 1


def mjo(out_dir, force=False):
    path = os.path.join(out_dir, "mjo.json")
    old = read_json(path, None)
    if old and not force:
        try:
            age = datetime.now(timezone.utc) - datetime.fromisoformat(old["readAt"].replace("Z", "+00:00"))
            if age < timedelta(hours=12):
                return False
        except (KeyError, ValueError):
            pass
    raw = None
    for url in MJO_URLS:
        try:
            raw = get(url, tries=2, timeout=60).decode("latin-1")
            if "RMM1" in raw or re.search(r"^\s*\d{4}\s+\d{1,2}\s+\d{1,2}\s+-?\d", raw, re.M):
                break
            raw = None
        except RuntimeError as e:
            print(f"MJO: {e}", file=sys.stderr)
    if not raw:
        return False
    days = []
    for y, mth, d, r1, r2, ph, amp in re.findall(
        r"^\s*(\d{4})\s+(\d{1,2})\s+(\d{1,2})\s+(-?[\d.]+(?:E[+-]\d+)?)\s+(-?[\d.]+(?:E[+-]\d+)?)\s+(\d)\s+([\d.]+(?:E[+-]\d+)?)",
        raw,
        re.M,
    ):
        r1, r2, amp = float(r1), float(r2), float(amp)
        if abs(r1) > 50 or abs(r2) > 50:  # 1.E36 marks a missing day
            continue
        days.append({"date": f"{int(y):04d}-{int(mth):02d}-{int(d):02d}", "rmm1": round(r1, 3), "rmm2": round(r2, 3), "phase": int(ph) or phase_of(r1, r2), "amp": round(amp, 3)})
    if not days:
        print("MJO: no rows in the index file", file=sys.stderr)
        return False
    dump(path, {"source": "Bureau of Meteorology (Australia), RMM index", "readAt": now_z(), "days": days[-MJO_DAYS:]})
    return True


def now_z():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    force = "--force" in sys.argv
    if len(args) != 1:
        sys.exit(__doc__)
    out = args[0]
    os.makedirs(out, exist_ok=True)
    changed = []

    try:
        html = get(PAGE).decode("utf-8", "replace")
    except RuntimeError as e:
        print(f"Couldn't read IMD's cyclone page: {e}", file=sys.stderr)
        sys.exit(1)
    links = page_links(html)
    if not links:
        print("IMD's cyclone page has no bulletin links (page changed?)", file=sys.stderr)
        sys.exit(1)
    pdf = next((u for k, t, u in links if k == "PDF" and t.lower() == "national bulletin"), None)
    track_img = next((u for k, t, u in links if k == "Image" and "track" in t.lower()), None)
    outlook = next((u for k, t, u in links if k == "PDF" and "outlook" in t.lower()), None)

    latest_path = os.path.join(out, "latest.json")
    latest = read_json(latest_path, {})
    if pdf and (force or latest.get("pdf") != pdf):
        with tempfile.TemporaryDirectory() as tmp:
            p = os.path.join(tmp, "b.pdf")
            with open(p, "wb") as f:
                f.write(get(pdf))
            text = pdf_text(p)
        b = parse_bulletin(text)
        if not b.get("no") and not b.get("forecast"):
            print("The National Bulletin couldn't be read (layout changed?)", file=sys.stderr)
            sys.exit(2)
        b["pdf"] = pdf
        b["readAt"] = now_z()
        latest = b
        hist = read_json(os.path.join(out, "history.json"), {"bulletins": []})
        rows = [h for h in hist.get("bulletins", []) if not (h.get("no") == b.get("no") and h.get("system") == b.get("system"))]
        rows.append(compact(b))
        rows.sort(key=lambda h: h.get("issued") or "")
        dump(os.path.join(out, "history.json"), {"bulletins": rows[-HISTORY:]})
        changed.append("bulletin")

    if track_img and (force or latest.get("trackImage") != track_img):
        try:
            save_picture(get(track_img), os.path.join(out, "track.jpg"))
            latest["trackImage"] = track_img
            changed.append("track")
        except RuntimeError as e:
            print(f"Track picture: {e}", file=sys.stderr)
    if outlook and latest.get("outlook") != outlook:
        latest["outlook"] = outlook
        changed.append("outlook")
    if changed:
        latest["checkedAt"] = now_z()
        dump(latest_path, latest)

    if mjo(out, force):
        changed.append("mjo")
    for c in changed:
        print(c)


if __name__ == "__main__":
    main()
