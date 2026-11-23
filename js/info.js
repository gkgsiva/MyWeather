// Info screen: which version is installed, where the data comes from, and
// what each release added (newest first). Keep HISTORY in step with the
// "Version history" section of README.md.
import { APP_VERSION } from "./version.js";

export const HISTORY = [
  {
    version: "1.19",
    date: "upcoming",
    groups: [
      [
        "Month card",
        [
          "**Month card** (Rain menu): this month's rain against normal on one card to share. Chennai district and Tamil Nadu from IMD's monthly rainfall figures with IMD's category (Normal, Excess, Deficient), the running total and wettest days from TN-SMART's Chennai gauges set against IMD's Chennai normal, and the other KTCC districts and the Tamil Nadu–Puducherry subdivision. The picture follows Settings → Shared pictures.",
        ],
      ],
    ],
  },
  {
    version: "1.18",
    date: "22 Nov 2026",
    groups: [
      [
        "Cyclone watch",
        [
          "**Finished storms drop off the list.** A storm IMD says has weakened into a low pressure area or dissipated is no longer shown as active (Akvan stayed on for a day after landfall), and IMD's track layer no longer keeps a storm alive for days. Storms from the other agencies disappear when they issue a final warning, say the storm has ended, or have not issued an advisory for 24 hours.",
          "The hourly reader that fetches storms from the National Hurricane Center, the Joint Typhoon Warning Center and GDACS now tells you in its log why each storm is left out, and tries GDACS's other feeds when the first one answers with nothing.",
        ],
      ],
      [
        "My places",
        [
          "**Weather for each place**: My places now shows the weather there now (temperature, feels like, humidity, wind), the **highest and lowest temperature for the last 7 days and the next 7** on a chart, today's chance of rain, a day-by-day **forecast** (rain chance and mm, wind and gusts, humidity) and a **Last 7 days** list with rain, temperatures, wind and humidity. Share works on each block. The last reading is kept for when there is no signal.",
          "**Nearest rain gauge**: if a TN-SMART gauge is within 15 km of the place, it names the gauge, how far it is, the rain it has measured since 8:30 AM and a chart of its last 7 rain days. With none that close, it says so. With the data saver on it looks at 2 days instead of 7.",
        ],
      ],
    ],
  },
  {
    version: "1.17",
    date: "17 Nov 2026",
    groups: [
      [
        "Cyclone track history",
        [
          "**Forecast vs what happened** (Cyclone watch): every forecast IMD, the National Hurricane Center and the Joint Typhoon Warning Center issue for a storm is now saved, and kept after the storm ends. Pick a storm and one of its forecasts: the map shows the forecast track dashed over where the storm really went, with the error in km at each point, and a table gives the average error by how far ahead the forecast looked (up to 12 h, 24 h, 48 h, 72 h and more). Saving starts from the day this was added, so older storms aren't there. Share carries the agency's credit.",
        ],
      ],
      [
        "My places",
        [
          "**My places** (Now menu): save your own places, such as a village, a street or a farm, by searching a name or pincode, using your location, or tapping the map. Each one shows its **rain for the last 30 days** (a chart, the last 7 and 30 days, rainy days and the wettest day, with Share) and opens **Model charts** with that place chosen. Places stay on your phone.",
          "In **Model charts**, your saved places are in the place list, and a spot you tap on the map can be saved with **Save this spot**.",
        ],
      ],
      [
        "Model charts",
        [
          "**Model agreement**: under *Charts for a place*, one line says how closely the six models agree on the rain for your district over the next 3 rain days: **High**, **Moderate** or **Low**, with a score for each day. When they agree, trust the rain figures more; when they disagree, expect it could be much more or less than any one model shows.",
          "**Works offline**: with no signal, Model charts shows the **last run it read**, with a yellow line saying when it was read and how old it is (the same if an update fails). Pictures you share from it say they are a saved run.",
        ],
      ],
      [
        "Radars",
        [
          "**Scrub the last 3 hours** on the Radars screen: **Play last 3 hours** now has a slider under the picture. Drag it back to any frame, or tap ▶ to play and ⏸ to pause. It shows about how long ago each frame is, and **Share** sends the frame you are on.",
        ],
      ],
    ],
  },
  {
    version: "1.16",
    date: "17 Nov 2026",
    groups: [
      [
        "Model charts",
        [
          "**Model charts** (Now menu): rain, wind and temperature over Tamil Nadu from six weather models side by side: **ECMWF**, **ECMWF AI**, **GFS**, **ICON**, **UK Met Office** and **GEM**. Choose **24-hour rain** (the next 24 hours, or each IMD rain day from 8:30 AM), **rain every 3 hours**, **wind** or **temperature**, and slide through the next 6 days. Six small maps show the models next to each other; **pinch or double-tap to zoom**. Tap one to see it on the big map, and tap the map for every model's figure at that spot.",
          "**Charts for a place**: pick a district (your home district first) or a spot on the map for lines of each model's rain every 3 hours, wind and temperature, and a **24-hour rain** bar chart with a table and the models' average. Every chart zooms and has Share.",
        ],
      ],
    ],
  },
  {
    version: "1.15",
    date: "16 Nov 2026",
    groups: [
      [
        "Cyclone watch",
        [
          "**Cyclone watch** (Radar & sky menu): the current depression or cyclone on one screen, like a forecaster's infographic. The headline gives IMD's own landfall forecast, the map shows the observed track, IMD's forecast track and its **landfall zone** along the coast, and numbered panels follow: at a glance, IMD's forecast table, **Tamil Nadu & Chennai** warnings and the closest approach to Chennai, **model guidance** (where ECMWF, GFS, ECMWF AI, UK Met Office and ICON take it), **steering flow & ridge**, the **MJO**, how IMD's forecast changed, **past storms** that crossed nearby, and IMD's track-and-cone picture. Every panel has Share.",
          "IMD's newest bulletin is read every hour, so the screen updates soon after IMD issues one. With no active system it says so and keeps the MJO and the past storms near Chennai.",
          "**Storms around the world**: every active tropical cyclone, hurricane and typhoon, from NOAA's National Hurricane Center (Atlantic and East & Central Pacific), the Joint Typhoon Warning Center (West Pacific, Indian Ocean and the Southern Hemisphere) and GDACS alerts, read every hour. A world map and a button for each storm sit at the top; tap one and the same panels show for it: the agency's forecast track and table, warnings and outlook, model tracks, steering and the MJO for its sea. The Indian storm is shown first.",
        ],
      ],
      [
        "Works better without signal",
        [
          "**Home** now shows what was saved straight away: the last **radar picture** of your default radar (a new one is fetched when it is over 10 minutes old and you're online), the last station reading, and the last nearest rain gauge, each marked as saved with its time. A yellow **No connection** line says so, and everything updates by itself when the signal returns.",
        ],
      ],
      [
        "Daily summary",
        [
          "**Morning digest** is now **Daily summary** with a **Summary** choice: **Morning outlook** (as before: the last rain day) or **Today so far** (the choice from noon): the rain since 8:30 AM at the TN-SMART gauges and IMD's top and bottom temperatures for Chennai from the daily report, ready to share with the text version.",
        ],
      ],
    ],
  },
  {
    version: "1.14",
    date: "15 Nov 2026",
    groups: [
      [
        "New",
        [
          "**Season card** (Rain menu): Chennai's northeast monsoon so far against normal on one card to share. Nungambakkam, Meenambakkam and Chennai district from IMD's daily report, the running total and wettest days from TN-SMART's Chennai gauges, and the other KTCC districts and Tamil Nadu. The picture follows Settings → Shared pictures.",
          "**Update notice**: when a newer MyWeather is on GitHub, a strip at the top offers its APK to download. **Check for updates** is on Info too.",
          "**Problem log** (Info → Problem log): downloads that failed, pictures that didn't load and app errors over the last week, to send as text or copy when something isn't working. Keys and tokens are blanked.",
        ],
      ],
      [
        "Better",
        [
          "Every APK is now signed with the same release key, so later versions install over this one. **This once**, Android may refuse to install v1.14 over an older version: back up in Settings, uninstall the old app, install v1.14 and restore.",
          "The daily data source check tries a failing source once more after 3 minutes, so a short outage no longer raises an alert.",
        ],
      ],
    ],
  },
  {
    version: "1.13",
    date: "15 Nov 2026",
    groups: [
      [
        "Better",
        [
          "**IMD daily report** says **Not updated today yet** when the newest report isn't today's. IMD issues it in the afternoon, and the app usually has it by about 4:30 PM.",
          "The daily report check now waits for its last try of the day (7 PM) before reporting a problem, so a slow IMD site in the afternoon no longer sends an alert.",
        ],
      ],
    ],
  },
  {
    version: "1.12",
    date: "15 Nov 2026",
    groups: [
      [
        "Easier to use",
        [
          "Settings: **Shared pictures**. Pick the name in the corner of every picture you share (gkgsiva unless you change it), or leave it empty for none. The app's own pictures get © and the name; IMD's pictures keep **Courtesy: India Meteorological Department** with the plain name.",
          "Also there: which **corner** the mark goes in, its **size** and **strength** (with a preview), whether shared maps, tables and charts show the **date and time** and the **MyWeather** name, and **your own text** (a hashtag or link) added to every share's message. All saved in backups.",
        ],
      ],
    ],
  },
  {
    version: "1.11",
    date: "15 Nov 2026",
    groups: [
      [
        "New",
        [
          "**IMD daily report**: the Regional Meteorological Centre, Chennai's daily weather report as charts and tables. The day's highest rain and hottest and coolest places, Nungambakkam and Meenambakkam with departures and the local forecast, max and min at every IMD station, the wettest places, station and district rain this season against normal, the 7-day forecast, weather systems and the report's maps. **Over the days** charts any station report by report. It reads a few kilobytes, not the 6 MB PDF.",
        ],
      ],
    ],
  },
  {
    version: "1.10",
    date: "9 Nov 2026",
    groups: [
      [
        "New",
        [
          "**Rainfall cards** to share as a picture, for the 24 hours ending 8:30 AM: **Tamil Nadu** or **KTCC (Chennai) top 20 to 100 places** (source, district, station, mm, the highest rainfall and the districts with most places), **districts you pick** with a coloured panel each (rank, gauge, bar, mm), or your **Wunderground stations**. For the rain day or the **last 1, 3, 6, 12 or 24 hours**. One or two columns.",
          "Every picture you share now carries a **© gkgsiva** mark in its corner. IMD's radar, satellite, lightning and warning pictures carry **Courtesy: India Meteorological Department** and a plain gkgsiva instead (animated loops are sent as IMD made them, with the credit in the message).",
        ],
      ],
    ],
  },
  {
    version: "1.9",
    date: "8 Nov 2026",
    groups: [
      [
        "New",
        [
          "**Rain nowcast** screen: will rain reach any place in Tamil Nadu in the next 2 hours? Pick a district, a place name, a pincode, your location or a spot on the map. Every district is listed by when rain arrives.",
          "Radar map: **Tamil Nadu (all 5 radars)** combines Chennai, Karaikal, Thiruvananthapuram, Kochi and Sriharikota into one map and loop, lining up their scan times.",
        ],
      ],
      [
        "More",
        [
          "**Rain map**: rain over the last 1 to 24 hours across Tamil Nadu, filled in between the 1,500 TN-SMART rain gauges, with district figures and any spot on the map.",
          "Radar map: **Cyclone track** from IMD's map server while a depression or cyclone is active.",
          "Flood spots: **Waterlogging risk** for each Chennai zone (rain, radar, flood spots and lakes).",
          "**Rain records**: each district's wettest days, spells, months and hours, linked to Rain spell.",
          "**Data saver**: the radar screens can read the latest pictures (0.8 MB) instead of the 3-hour loops (16 MB); Auto saves on mobile data.",
        ],
      ],
      [
        "Easier to use",
        [
          "**Simpler menu**: screens grouped into Now, Radar & sky, Rain, Lakes & floods, and Stations & tools, two to a row.",
          "**Settings** screen: home district, °C or °F, wind in km/h, knots, mph or m/s, default radar, data saver, theme, which screens the menu shows, and **backup and restore** of your favourites, stations and places.",
          "**Faster start**: each screen's code loads when it is first opened (Home now starts with a quarter of the code); the rest loads in the background.",
          "A daily check that IMD, TN-SMART, the lakes page, Wunderground, Open-Meteo and the Kea blog still answer, so a broken source is spotted early.",
        ],
      ],
    ],
  },
  {
    version: "1.8",
    date: "8 Nov 2026",
    groups: [
      [
        "New",
        [
          "**Info** screen in the menu: the installed version and this version history.",
          "Home's **Rain coming?** card: **📍 Spot** picks the place to check, by name, pincode or a tap on a map.",
        ],
      ],
    ],
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
  const upd = document.getElementById("info-update");
  const updSay = document.getElementById("info-update-status");
  upd.addEventListener("click", async () => {
    upd.disabled = true;
    updSay.className = "status";
    updSay.textContent = "Asking GitHub…";
    try {
      const { checkNow } = await import("./update.js");
      updSay.textContent = await checkNow();
    } catch (e) {
      updSay.className = "status error";
      updSay.textContent = `Couldn't reach GitHub (${e.message || e}).`;
    } finally {
      upd.disabled = false;
    }
  });
  // Five quick taps on the version line open the Problem log too.
  let taps = [];
  document.getElementById("info-version").addEventListener("click", () => {
    const now = Date.now();
    taps = [...taps.filter((t) => now - t < 3000), now];
    if (taps.length >= 5) {
      taps = [];
      location.hash = "#errors";
    }
  });
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
