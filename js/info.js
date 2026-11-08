// Info screen: which version is installed, where the data comes from, and
// what each release added (newest first). Keep HISTORY in step with the
// "Version history" section of README.md.
import { APP_VERSION } from "./version.js";

export const HISTORY = [
  {
    version: "1.8",
    date: "Upcoming",
    groups: [["New", ["**Info** screen in the menu: the installed version and this version history."]]],
  },
  {
    version: "1.7",
    date: "8 Nov 2026",
    groups: [
      [
        "New screens",
        [
          "**Morning digest**: warnings, forecast, last day's rain, monsoon so far, lakes and sun times in one card, for any TN district or all of KTCC (Chennai, Kanchi, Chengalpet, Tiruvallur). Share it on WhatsApp as a picture with a text summary.",
          "**Heat & humidity**: heat index, wet bulb and heat stress for the next 48 hours, for any district, place name or pincode.",
          "**Year on year**: this northeast monsoon against every season since 2000, for Chennai and every TN district.",
          "**Station health**: offline or odd Wunderground stations and TN rain gauges; suspect readings are left out of maps and averages.",
          "**Rain spell**: the latest spell of rain in one screen (total, wettest gauges, map, radar, flood spots).",
        ],
      ],
      [
        "Radar map",
        [
          "**Rain nowcast**: when rain will reach Chennai, your location or a spot you tap. Home has a **Rain coming?** card.",
          "**Clouds (INSAT)**: satellite clouds under the radar echoes.",
          "More radars: Karaikal, Sriharikota, Thiruvananthapuram and Kochi.",
        ],
      ],
      [
        "More",
        [
          "**Rain & temperature** home-screen widget.",
          "**Share** button on every map, table, chart and list.",
          "TN rain gauges: 7- and 30-day history for each gauge.",
          "Lakes: storage over the last 30 or 90 days against last year.",
          "Home: **Near you** card (nearest station, gauge and radar).",
          "The menu now stays above maps.",
        ],
      ],
    ],
  },
  {
    version: "1.6",
    date: "7 Nov 2026",
    groups: [
      [
        "New",
        [
          "Home: **favourites** (☆ pins a screen to the top), a live **station strip** and **sun and moon** times.",
          "**Rain season**: every saved station's rain since 1 October.",
          "**Flood spots**: Chennai's known waterlogging spots with today's rain near each.",
          "**Wind & storms**: moving wind over the Bay of Bengal for the next 2 days, plus the Windy map.",
          "**Radar map**: Chennai radar echoes on a map, with the 3-hour loop and storm movement.",
          "**TN rain gauges**: Tamil Nadu's ~1,500 gauges hour by hour (map, table, charts).",
        ],
      ],
    ],
  },
  {
    version: "1.5",
    date: "7 Nov 2026",
    groups: [
      [
        "New",
        [
          "**Lightning**: how close the last 30 minutes of lightning is to Chennai, from IMD's lightning map.",
          "**Share** buttons on Radars, Satellite and Lightning (WhatsApp or any app).",
          "**Pull to refresh** on every screen.",
        ],
      ],
    ],
  },
  {
    version: "1.4",
    date: "6 Nov 2026",
    groups: [
      [
        "New",
        [
          "**Forecast**: 24 hours and 7 days for Chennai (Open-Meteo).",
          "**Monsoon**: IMD's rain against normal for Chennai, TN and every district.",
          "**Compare stations**: two or three stations through a day or a month.",
          "**Station map**: every saved station on a map, coloured by rain or temperature.",
          "**Air quality**: Chennai's AQI on India's scale, plus CPCB's readings by area.",
          "**Sea & tides**: tide times, waves and sea temperature off Marina Beach.",
        ],
      ],
      ["Fixes", ["The header and menu button sit below the status bar, and the menu button is bigger."]],
    ],
  },
  {
    version: "1.3",
    date: "6 Nov 2026",
    groups: [
      [
        "New",
        [
          "**Rain history**: 7 days for every station, and month and 12-month charts per station.",
          "**Cyclones**: IMD's bulletins and track maps.",
          "**Lakes**: Chennai's reservoir storage from Metro Water.",
          "**Offline**: the last radar, readings and lists are shown when the network drops.",
          "**Dark mode**: follows the phone, or pick Dark or Light in the menu.",
          "Coloured header bar with the ☰ menu.",
        ],
      ],
    ],
  },
  {
    version: "1.2",
    date: "6 Nov 2026",
    groups: [
      [
        "New",
        [
          "**Radar widget** for the home screen (latest Chennai radar picture).",
          "Radar **loop** of the last 3 hours.",
          "**Satellite**: IMD's INSAT pictures and loops.",
          "**Warnings**: IMD's district nowcast and 5-day warnings for Tamil Nadu.",
          "Wunderground **dashboard** of all saved stations.",
          "APKs can be signed with your own key, so updates install over the old app.",
        ],
      ],
    ],
  },
  {
    version: "1.1",
    date: "6 Nov 2026",
    groups: [
      [
        "New",
        [
          "**Home** page with a menu.",
          "**Wunderground** stations (23 Chennai stations by nickname; add or remove your own).",
          "**Kea Blog**: the latest posts from kwschennai.com.",
          "Radar: no auto-refresh; **Set as default** keeps your city and product.",
          "Ads on Wunderground pages are hidden in the app.",
          "The Android app (APK) is attached to every release.",
        ],
      ],
    ],
  },
  {
    version: "1.0",
    date: "6 Nov 2026",
    groups: [
      [
        "First release",
        [
          "Current IMD Doppler radar image by city: 36 radar stations and 7 products.",
          "Images load straight from mausam.imd.gov.in, with the direct link shown.",
          "The choice is kept in the link, so it can be bookmarked or shared.",
        ],
      ],
    ],
  },
];

// **bold** → <b>, everything else as text.
function rich(text) {
  const frag = document.createDocumentFragment();
  text.split(/\*\*(.+?)\*\*/).forEach((part, i) => {
    if (!part) return;
    if (i % 2) {
      const b = document.createElement("b");
      b.textContent = part;
      frag.append(b);
    } else frag.append(part);
  });
  return frag;
}

export function initInfo() {
  const installed = APP_VERSION || "";
  document.getElementById("info-version").textContent = installed
    ? `Version ${installed}`
    : "Development copy (not built from a release)";
  const list = document.getElementById("info-history");
  HISTORY.forEach((rel, n) => {
    const d = document.createElement("details");
    d.className = "info-release";
    if (rel.version === installed || (!n && !HISTORY.some((r) => r.version === installed))) d.open = true;
    const s = document.createElement("summary");
    const v = document.createElement("strong");
    v.textContent = `v${rel.version}`;
    const when = document.createElement("span");
    when.textContent = rel.date;
    s.append(v, when);
    if (rel.version === installed) {
      const tag = document.createElement("em");
      tag.textContent = "installed";
      s.append(tag);
    }
    d.append(s);
    for (const [head, items] of rel.groups) {
      const h = document.createElement("h4");
      h.textContent = head;
      const ul = document.createElement("ul");
      for (const item of items) {
        const li = document.createElement("li");
        li.append(rich(item));
        ul.append(li);
      }
      d.append(h, ul);
    }
    list.append(d);
  });
}
