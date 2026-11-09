# MyWeather

A small static web app for Chennai weather watchers. A home page and the ☰ menu in the header bar lead to:

- **Home** (`#home`): the main Wunderground station's reading now (temperature, rain today, rain rate, wind,
  humidity; the first saved station unless another is picked in the strip), Chennai's sunrise, sunset, daylight,
  moonrise, moonset and moon phase (worked out on the phone in `js/astro.js`, no network), **Favourites** (tap ☆
  on any card to pin that screen to the top) and every screen. **Near you** (off until **Use my location** is
  tapped) uses the phone's position: the strip follows the nearest saved station within 50 km, and it lists the
  nearest radar on the radar map, the nearest TN rain gauge (today's total) and gives sun and moon for that
  place. Picking a station by hand turns it off. The Android app asks for location permission the first time
  (`ACCESS_COARSE_LOCATION`/`FINE`, granted to the app's own page only).
- **Morning digest** (`#digest`): one card for the day (IMD warnings for Chennai, today's and tomorrow's
  forecast, the last rain day at the TN-SMART gauges, the monsoon so far, the lakes, sunrise and sunset, and the
  radar nowcast when it is fresh). **Share on WhatsApp** sends it as a picture with the same summary as text.
- **Forecast** (`#forecast`): Chennai's weather now, the chance of rain for each of the next 24 hours, and
  7 days ahead (high/low, rain chance, expected mm, wind). From [Open-Meteo](https://open-meteo.com/)
  (`api.open-meteo.com`, no key), which blends ECMWF, GFS and other models.
- **Heat & humidity** (`#heat`): the heat index ("feels like", US weather service formula) and wet-bulb
  temperature now and for the next 48 hours, with heat stress levels hour by hour and the hottest feel of each
  day, from Open-Meteo (the phone's place when Near you is on). The home station's latest reading is shown too.
- **Radars** (`#radar`): the current India Meteorological Department (IMD) Doppler radar image.
  - Choose a **city** (36 IMD radar stations) and a **product** (MAX (Z), PPI, rainfall intensity, etc.).
  - The image loads straight from IMD, e.g. `https://mausam.imd.gov.in/Radar/caz_cni.gif` for Chennai,
    and the direct link is shown under it.
  - There is no auto-refresh; press **Refresh** for the latest image.
  - Chennai is selected by default. **Set as default** saves the current city and product on this device.
  - The choice is kept in the URL (`?city=cni&product=caz#radar`), so it can be bookmarked or shared.
  - **Play last 3 hours** swaps in IMD's radar loop (MAX (Z) and Surface Rainfall Intensity only),
    e.g. `https://mausam.imd.gov.in/Radar/animation/Converted/CNI_MAXZ.gif`; kept in the URL as `&anim=1`.
- **Radar map** (`#radarmap`): IMD radars on an OpenStreetMap map, with a **Radar** picker: Chennai (five layers),
  Karaikal, Thiruvananthapuram and Kochi (MAX (Z) loop), Sriharikota (latest MAX (Z) picture only: its loop is
  24 MB with one scan an hour). Each station draws its pictures differently, so each has its own measured plot
  area, grid and title position in `RADARS` (`js/radarmap.js`); Karaikal's title font has its own digit
  templates. `#radarmap?station=kkl` opens a station. For Chennai: **MAX (Z)** and **Rain rate (SRI)**
  come from IMD's 3-hour loops: each frame is blurred a little (IMD's GIFs are dithered) and compared with the
  per-pixel median of all frames, which is the bare base map, so only the rain is drawn, in IMD's colours. A slider
  and ▶ play the loop. The frame times are read off each picture's title with digit templates. **Storm movement**
  comes from matching the rain between frames over the last hour (best overlap of the echoes, then the median of
  the speeds); it is the app's own estimate, shown as text and an arrow to where the rain would be in an hour.
  **PPI Z** (150 and 500 km) and **radial wind (PPI V)** have no loop, so the whole picture is laid on the map
  with an opacity slider. IMD's VVP wind-by-height chart is under the map. The plots sit on a latitude/longitude
  grid (or kilometres around the radar) measured on each image, re-spaced for Mercator. GIFs are decoded
  by `js/gif.js`. Needs the Android app for the CORS header.
  **Rain nowcast**: from the storm movement, the app looks upstream of a place to say when the rain will reach it
  ("Rain likely in about 40 min, for about 25 min"), up to 2 hours ahead. The place is Chennai, the phone's
  position (Near you) or a spot tapped on the map. Home's **Rain coming?** card runs the same check on demand;
  its **📍 Spot** button picks the place on a map (tap anywhere) or by searching a place name or pincode, and
  the app remembers it.
  **Tamil Nadu (all 5 radars)** (`js/mosaic.js`) puts Chennai, Karaikal, Thiruvananthapuram, Kochi and Sriharikota
  on one map. The radars use different colour scales, so each echo's colour is read back to dBZ on that radar's own
  colour bar (sampled Nov 2026); where radars overlap the stronger reading wins, and echoes under 20 dBZ are left
  out. Frames step every 10 minutes over 3 hours; each radar gives its latest scan from the 30 minutes before,
  moved on along its storm track to the step's time, and the scans used are listed under the slider. Storm motion
  is each radar's own; the nowcast uses the nearest radar's.
- **Rain map** (`#rainmap`, `js/rainmap.js`): rain over the last 1, 3, 6, 12 or 24 hours from TN-SMART's hourly
  gauges (suspect ones left out; a gauge needs 90% of the hours), filled in on a 2 km grid by inverse-distance
  weighting from the gauges within 20 km, kept inside TN's district outlines. District figures are the mean of
  their gauges and the wettest gauge. (A radar-based version read only about 7% of the gauges' rain, so it was
  dropped.)
- **Cyclone track** on the Radar map (`js/cyclonetrack.js`): IMD's map server layer `imd:Cyclone_Track_V` (filled only
  while a system is active), coloured by stage. IMD doesn't publish the forecast cone as data.
- **Waterlogging risk** (Flood spots, `js/waterlog.js`): each GCC zone low/medium/high from its TN-SMART zone gauges
  (24 h, 3 h), radar rain due within the hour (only if the radar was just read), known flood spots and lakes
  upstream over 90% full.
- **Rain records** (`#records`): wettest days, spells (2.5 mm+ days in a row), months and hours for each district,
  from TN-SMART's daily district means (from 11 Oct 2025, kept on the phone); days and spells open Rain spell
  (`#spell?area=…&from=…&to=…`).
- **Data saver** (`js/datasaver.js`, Auto / Saver / Full on the radar screens): reads each radar's latest picture
  (about 0.8 MB) and lifts the rain out with the bare map saved from the last full loop; storm motion from that loop
  if under 2 hours old. Auto saves on mobile data or with the phone's data saver.
- **Rain nowcast** (`#nowcast`): will rain reach a place in the next 2 hours, from the Tamil Nadu mosaic. Pick a
  district, search a place name or pincode, use the phone's location or tap the map. Below, every TN district
  (at its centre) sorted by when rain arrives. **Use this place on Home** sends the place to Home's card.
  **Clouds (INSAT)** lays IMD's INSAT-3DS infrared picture (Asia sector, Mercator; grid measured Nov 2026) under
  the radar echoes, see-through where the sky is clear.
- **TN rain gauges** (`#gauges`): the Tamil Nadu government's ~1,500 automatic rain gauges (TN-SMART, with RIMES),
  hour by hour, from the JSON the public
  [hourly page](https://beta-tnsmart.rimes.int/index.php/RTDAS/Hourly_data_TNDRRA_c/public) reads
  (`https://beta-tnsmart.rimes.int/Rainfall_Python_IDW/Hourly_json/hourly_rainfall_<day>.json`, one file per rain
  day of 8:30 AM to 8:30 AM, named by the day it ends; CORS is open). Filters for district, amount of rain and a
  name search apply to three tabs: a **map** (dots for many gauges, numbered pins for up to 60 or when zoomed in; tap one for its
  hourly chart), a sortable **table** (total, last hour, wettest hour) and **charts** (average rain per hour,
  gauges per IMD rain band, gauges with rain each hour, the 10 wettest gauges and districts by average rain).
  Any past day can be picked. Under a gauge's hourly chart, **7 days** / **30 days** show its rain each day with
  its district's average and IMD's weekly district normal (`rainfallinformation.php?msg=W`; 30 days is that ×30/7).
  Past days are downloaded once (~0.7 MB each) and kept in IndexedDB (`js/gaugedays.js`, shared with Rain spell).
  `#gauges?gauge=<district>|<gauge>` opens one gauge.
- **Rainfall cards** (`#distrank`, `js/distrank.js`): ranking cards for the rain day ending 8:30 AM (the running day
  shows rain so far), shared as a picture: Tamil Nadu or KTCC top 20/30/50/100 places (source GCC for "Z nn" gauges,
  else TNDRRA; highest rainfall; districts with most places), or the districts you pick (KTCC to start; up to 8), one
  coloured panel each with rank, gauge, bar and mm. Period: the rain day, or the last 1/3/6/12/24 hours up to the
  latest hour any gauge reported (reaching into the day before when needed). One or two columns. From the same TN-SMART hourly file, so TNDRRA's manual taluk and IMD gauges aren't included.
- **Station health** (`#health`): Wunderground stations and TN-SMART gauges that are offline or sending readings
  that don't add up (impossible values, day totals that don't match their hours, stuck readings, or far from every
  neighbour). Suspect readings are greyed or marked **?** on the maps and left out of averages and rankings; a
  switch here (and on the gauges screen) turns that off.
- **Rain spell** (`#spell`): the latest run of rain days (at least 2.5 mm on average over the area in the last two
  weeks, plus a lighter day either side) for a district (Chennai by default) or all Tamil Nadu, or any dates up
  to 31 days: average total, rain each day, the 10 wettest gauges, a map of every gauge's total, the radar (IMD's
  3-hour loop while the spell is going; IMD keeps nothing older) and the flood spots with the most rain at the
  nearest gauge. **Share** draws it all as one picture.
- **Satellite** (`#satellite`): IMD's INSAT pictures (Asia sector, full disc) and loops, from
  `https://mausam.imd.gov.in/Satellite/`.
- **Lightning** (`#lightning`): how close the lightning of the last 30 minutes is to Chennai, from IMD's
  satellite lightning map (`https://mausam.imd.gov.in/lightning/Converted/BT.gif`, IITM's lightning network on an
  INSAT cloud-top picture, redrawn every few minutes). The app reads the marker colours off the map's last frame
  (red: last 10 min, green: 10–20 min, purple: 20–30 min) and shows the nearest lightning's distance and
  direction, the spots within 50, 100 and 200 km, and a close-up around Chennai with those rings. **All India**
  shows IMD's animation. Distances are good to about 10 km (one map pixel is about 7 km). The map's position on
  the picture was fitted to its coastline (`MAP` in `js/lightning.js`); if IMD changes the picture's size the app
  says so and shows only the map. Needs the Android app for the CORS header.
- **Warnings** (`#warnings`): IMD's district-wise nowcast (next 3 hours) and 5-day warnings for Tamil Nadu and
  Puducherry, as a map and a district list (Chennai first). Both come from IMD's GeoServer at
  `reactjs.imd.gov.in`; the list needs the Android app, which adds the missing CORS header.
- **Wind & storms** (`#wind`): moving wind particles over the Bay of Bengal (5–21°N, 78–94°E), coloured by IMD's
  depression and cyclone categories, with a slider through the next 2 days in 3-hour steps, the wind at Chennai,
  the strongest wind and the lowest pressure on the map (marked L below 1004 hPa). From Open-Meteo's forecast on a
  1° grid in one request (`temporal_resolution=hourly_3`); the last forecast is kept on the phone. **Windy map**
  shows Windy's embeddable map (`embed.windy.com`) under the menu for more layers.
- **Cyclones** (`#cyclone`): IMD's current cyclone bulletins (Tropical Weather Outlook, National and Hourly
  bulletins, as PDFs) and the track, wind and storm-surge maps, read from IMD's
  [Cyclone Information](https://mausam.imd.gov.in/responsive/cycloneinformation.php) page. The app adds the
  missing CORS header.
- **Monsoon** (`#monsoon`): rain against normal for Chennai, Tamil Nadu, the Tamil Nadu–Puducherry
  subdivision, the districts around Chennai and every Tamil Nadu district, for the season so far (from
  1 October, IMD's cumulative figure), this month, the last week or yesterday. Read from IMD's
  [rainfall information](https://mausam.imd.gov.in/responsive/rainfallinformation.php) pages (district, state
  and subdivision, `?msg=C|M|W|D`), whose map data carries actual, normal and departure for each area. The app
  adds the missing CORS header.
- **Year on year** (`#yoy`): this northeast monsoon (from 1 October) against every season since 2000 to the same
  day, for Chennai, every Tamil Nadu district and the state: running totals, each season's bar and a table of all
  districts. From the ERA5 reanalysis via Open-Meteo's archive (one source for every year), with IMD's measured
  figure alongside. Past seasons are kept on the phone.
- **Rain history** (`#rain`): every saved station's rain for the last 7 days side by side, and per station
  (`#rain?id=ICHENN47&month=2026-11`) a daily chart for a month and a monthly chart for the last 12 months.
  The data is Wunderground's (`api.weather.com` `dailysummary/7day` and `history/daily`, with the same key as
  the dashboard). History comes one day per request, so each finished day is kept on the phone and only
  today is fetched again; requests are spaced about 2 seconds apart to stay inside the key's limits.
- **Rain season** (`#season`): every saved station's total rain since 1 October (the northeast monsoon season;
  from January to September, the last season), wettest first, with rainy days (2.5 mm or more) and the wettest
  day. Uses the daily totals Rain history keeps on the phone; opening it asks only for the last 7 days, and
  **Load the whole season** fetches the missing days one request at a time (about 2 seconds apart).
- **Compare stations** (`#compare?ids=ICHENN47,ICHENNAI1&day=2026-11-05` or `&month=2026-10`): two or three
  stations' rain as running totals through a day (every reading of the day, `history/all` or
  `observations/all/1day`, one request per station) or a month (the daily totals Rain history keeps on the
  phone, fetching only missing days).
- **Station map** (`#map`): every saved station on an OpenStreetMap map, marked and coloured by rain today
  (IMD's daily bands), rain rate or temperature; tap one for its readings and links. Positions come with the
  readings and are kept on the phone. [Leaflet](https://leafletjs.com/) 1.9.4 is bundled in `js/vendor/leaflet`
  (BSD-2 licence). The Android app fetches the tiles with its own User-Agent, as OpenStreetMap's tile policy asks.
- **Flood spots** (`#floods`): Chennai's known waterlogging spots (low-lying areas and road subways that
  flooded in 2015, 2021 and 2023, listed with rough positions in `js/flood-spots.js`) on the map with today's rain
  at the stations. Each spot takes the rain at the nearest station within 6 km: **Watch** from 30 mm a day or
  15 mm/h, **Likely flooded** from 64.5 mm a day or 30 mm/h. Your own spots can be added (kept on the phone). The
  Chennai radar links here.
- **Lakes** (`#lakes`): storage in Chennai's reservoirs, read from Chennai Metro Water's
  [lake-level page](https://cmwssb.tn.gov.in/lakelevel) (percent full when the table has capacity and
  storage columns). **Open Metro Water page** shows the page itself under the menu. **Storage over time** charts
  the five lakes (or one) over 30 or 90 days against the same days last year, from TN-SMART's daily reservoir
  report (`https://beta-tnsmart.rimes.int/DATA/Rainfall/daily_reservoir/reservoir_<DD-MM-YYYY>.pdf`, ~30 KB,
  CORS open), read by a small PDF text reader in `js/laketrend.js`; days read are kept in localStorage.
- **Air quality** (`#air`): Chennai's AQI on India's National AQI scale (CPCB bands and breakpoints), now and
  every 3 hours for the next few days, with each pollutant's sub-index. Worked out from the Copernicus (CAMS)
  pollution forecast via Open-Meteo (`air-quality-api.open-meteo.com`): 24-hour means for PM2.5, PM10, NO₂ and
  SO₂, 8-hour means for CO and ozone. CAMS is a ~40 km model, so it is one figure for the city; **CPCB readings
  by area** opens CPCB's own [AQI page](https://airquality.cpcb.gov.in/AQI_India/) under the menu for the
  measured values at each Chennai station (CPCB has no public feed for apps).
- **Sea & tides** (`#sea`): high and low tide times and heights, the sea level curve, waves, swell and sea
  temperature off Marina Beach for 3 days, from Open-Meteo's marine forecast (`marine-api.open-meteo.com`). Tide
  times are the turning points of the forecast sea level (which includes the tide), so they are a guide
  (about ±30 minutes), not for navigation.
- **Wunderground** (`#wunderground`): a dashboard of current temperature, rain and wind for all saved
  stations, from `api.weather.com`. Picking a station shows its Wunderground page under the menu
  (`#wunderground?id=ICHENN47`). Stations are added and removed under **Manage stations** (saved on the phone).
  The default list is in [`js/pws-stations.js`](js/pws-stations.js).
  The readings need a Wunderground API key: set the `WEATHER_API_KEY` repository secret to build it into the
  APK, or enter one under **Manage stations**. Never commit the key.
- **Kea Blog** (`#blog`): the latest posts from [kwschennai.com/blog](https://kwschennai.com/blog/)
  (read from the site's WordPress feed); a post opens under the menu.
- **Info** (`#info`): the installed version (the APK workflow writes it into `js/version.js`), where each
  screen's data comes from, and the version history below, newest first (kept in `HISTORY` in `js/info.js`).

**Share:** Radars, Satellite and Lightning have a **Share** button that sends the picture on screen, with a
one-line caption, to WhatsApp or any other app through Android's share sheet (the Lightning close-up is shared
with its distance rings). The page hands the picture to the app over a message channel that only the app's own
page can use; the app saves it in its cache and shares it through a `FileProvider`. In a browser it uses the Web
Share API, or downloads the picture.

Every map, table, chart and list (Station map, TN rain gauges, Radar map, Flood spots, Wind, Rain history,
Rain season, Compare, Forecast, Monsoon, Warnings, Lakes, Air quality, Sea & tides, Wunderground) also has a
small **Share** button. It turns that block, as it is on screen, into a PNG with a MyWeather band naming it
(with the chosen layer, district or day) and the time, and shares it the same way. Maps keep their place, zoom
and markers; tables are shared whole. `js/snap.js` does this with
[html-to-image](https://github.com/bubkoo/html-to-image) (MIT, bundled in `js/vendor/html-to-image`); a block
gets the button by having `data-share="Title"` in `index.html`.

**Pull to refresh:** at the top of any screen, pull down and let go to reload it (the screen's own **Refresh**,
or the page shown under the menu). It works on Wunderground and blog pages too: the app adds a few lines to
those pages that pass the gesture to MyWeather. The station map is left out, since dragging it moves the map.

**Offline:** the last radar image for each city and product, the lightning map, the station readings and positions, the cyclone
list, the lake table, and the last forecast, monsoon figures, air quality and sea forecast are kept on the phone and shown, with the time they were saved, when the network drops.

**Dark mode:** the theme follows the phone; the **Theme** button at the bottom of the menu (☰), or **Settings**, switches between Auto, Dark and Light.

**Settings** (menu → Stations & tools): home district, units (°C/°F; km/h, knots, mph, m/s), default radar, data saver, theme, which screens the menu shows ("Choose screens…" at the bottom of the menu), and backup and restore of your favourites, stations and places as a small JSON file (the API key is left out).

The app is meant for the Android app on a phone. Wunderground pages can only be shown in a frame there:
the app drops Wunderground's no-framing headers and blocks requests to common ad servers.

## Data source check

`.github/workflows/data-sources.yml` runs `scripts/check-sources.mjs` every morning at 07:00 IST. It fetches each
source the app reads (IMD radar, satellite, lightning, rainfall and cyclone pages and map server; TN-SMART gauges
and district files; Chennai Metro Water lake levels; Wunderground; Open-Meteo; the Kea blog) and checks the answer
looks as the app expects. (Chennai Metro Water's page often refuses servers outside India, so it is only reported; TN-SMART's reservoir report is
checked for the lakes instead.) If any fail, it opens an issue **Data source check failed** (or adds the day's report to
it), and closes the issue once everything answers again. Run it any time from **Actions → Data sources → Run
workflow**, or locally with `node scripts/check-sources.mjs`. The Wunderground check uses the `WEATHER_API_KEY`
secret and is skipped without it.

## Version history

The same list is on the app's **Info** screen (`js/info.js`); keep the two in step.

### v1.10 (upcoming)
- **Rainfall cards** (Rain menu), to share as a picture for the 24 hours ending 8:30 AM: Tamil Nadu or KTCC top
  places (with the highest rainfall and the districts with most places), or a coloured panel per district you pick.

### v1.9 (8 Nov 2026, PRs #25–#27)
- **Rain nowcast** screen: will rain reach any place in Tamil Nadu in the next 2 hours? Pick a district, a place
  name, a pincode, your location or a spot on the map; every district is listed by when rain arrives.
- Radar map: **Tamil Nadu (all 5 radars)** combines Chennai, Karaikal, Thiruvananthapuram, Kochi and Sriharikota
  into one map and loop, lining up their scan times.
- **Rain map** (1 to 24 h of rain filled in between the TN-SMART gauges, by district and spot); **Cyclone track** on the Radar map; **Waterlogging risk** by Chennai zone on Flood spots;
  **Rain records** by district; **Data saver** for the radar screens.
- **Simpler menu** in sections (Now, Radar & sky, Rain, Lakes & floods, Stations & tools); **Settings** screen
  (home district, units, default radar, data saver, theme, choose the menu's screens, backup and restore);
  **faster start** (screens load on first use); a daily **data source check** (see below).

### v1.8 (8 Nov 2026, PRs #22–#23)
- **Info** screen in the menu: the installed version and this version history.
- Home's **Rain coming?** card: **📍 Spot** picks the place to check, by name, pincode or a tap on a map.

### v1.7 (8 Nov 2026, PRs #16–#21)
- New screens: **Morning digest** (warnings, forecast, last day's rain, monsoon so far, lakes and sun times in one
  card, for any TN district or all of KTCC; share on WhatsApp), **Heat & humidity** (heat index, wet bulb, heat
  stress for 48 hours, any district, place or pincode), **Year on year** (this NE monsoon against every season since
  2000), **Station health** (offline or odd stations and gauges left out) and **Rain spell**.
- Radar map: **Rain nowcast** (when rain reaches Chennai, your location or a tapped spot; Home's **Rain coming?**
  card), **Clouds (INSAT)** under the echoes, and Karaikal, Sriharikota, Thiruvananthapuram and Kochi radars.
- **Rain & temperature** home-screen widget; **Share** on every map, table, chart and list; 7- and 30-day history
  per TN gauge; lake storage over 30 or 90 days against last year; Home **Near you**; the menu stays above maps.

### v1.6 (7 Nov 2026, PRs #14–#15)
- Home: favourites, live station strip, sun and moon.
- **Rain season**, **Flood spots**, **Wind & storms**.
- **Radar map**: Chennai radar echoes on a map with the 3-hour loop and storm movement.
- **TN rain gauges**: Tamil Nadu's ~1,500 gauges hour by hour (map, table, charts).

### v1.5 (7 Nov 2026, PR #13)
- **Lightning** near Chennai, **Share** buttons on Radars, Satellite and Lightning, and **pull to refresh**.

### v1.4 (6 Nov 2026, PRs #11–#12)
- **Forecast**, **Monsoon**, **Compare stations**, **Station map**, **Air quality** and **Sea & tides**.
- The header and menu button sit below the status bar; the menu button is bigger.

### v1.3 (6 Nov 2026, PRs #8–#10)
- **Rain history**, **Cyclones**, **Lakes** (Metro Water's lake-level page), **offline** view and **dark mode**.
- Coloured header bar with the ☰ menu.

### v1.2 (6 Nov 2026, PRs #6–#7)
- Chennai **radar widget** for the home screen, and signing APKs with your own key.
- Radar **loop**, **Satellite**, Tamil Nadu **Warnings** and the Wunderground station **dashboard**.

### v1.1 (6 Nov 2026, PRs #2–#5)
- **Home** page with a menu, **Wunderground** stations and the **Kea Blog**.
- Radar: no auto-refresh, **Set as default**. Wunderground ads hidden in the app.
- An Android APK attached to every release.

### v1.0 (6 Nov 2026, PR #1)
- Current IMD Doppler radar image by city (36 stations, 7 products), straight from mausam.imd.gov.in, with the
  choice kept in the link.

## Run locally

No build step. Serve the folder with any static server (ES modules need http, not `file://`):

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

It can also be hosted as-is on GitHub Pages.

## Adding a station

Station codes come from `https://mausam.imd.gov.in/responsive/radar.php?id=<City>`
and live in [`js/stations.js`](js/stations.js). The image URL pattern is
`https://mausam.imd.gov.in/Radar/<product>_<code>.gif`.

## Android app

[`android/`](android) is a small Android app that shows the same page in a WebView
(the web files are copied into the APK at build time). Each GitHub release gets a
`MyWeather-<version>.apk` attached by the [Android APK workflow](.github/workflows/android-apk.yml):

- Publishing a release, or pushing a version tag such as `v1.1` (which creates the release), builds and attaches the APK automatically.
- For a release that already exists, open **Actions → Android APK → Run workflow**
  and enter its tag (e.g. `v1.0`).

To install, download the APK on the phone and allow installs from that source.
Build locally with `cd android && ./gradlew assembleRelease` (needs the Android SDK).

### Radar widget

The app adds a **MyWeather** home-screen widget with the latest IMD Chennai radar image
(MAX (Z), `caz_cni.gif`) and the time IMD updated it. Long-press the home screen →
**Widgets** → **MyWeather** to add it; it can be resized. Android refreshes it about every
30 minutes, **↻** fetches it right away, and tapping the image opens the Chennai radar in the app.

### Rain & temperature widget

A second widget, **Rain & temperature**, shows the main Wunderground station from the Home
screen: temperature, rain so far today, rain rate now, wind, humidity and the reading time.
It uses the same station and API key as the app, so open MyWeather once after adding it
(and again after picking another station on Home). It refreshes about every 30 minutes,
**↻** reads it right away, and tapping it opens Home.

### Signing with your own key

Without signing secrets the APK is signed with a throwaway debug key, so a newer APK
needs the old one uninstalled first. Signing every release with the same key of your
own lets new versions install over old ones. One-time setup:

1. **Make a keystore** on your computer. `keytool` comes with Java or Android Studio
   (on Windows it is in `C:\Program Files\Android\Android Studio\jbr\bin`):

   ```sh
   keytool -genkeypair -v -keystore myweather.jks -alias myweather \
     -keyalg RSA -keysize 2048 -validity 10000
   ```

   Pick a password, and press Enter at "key password" to reuse it. Name and
   organisation can be anything.
   **Back up `myweather.jks` and the password** (e.g. in a password manager). If either
   is lost, future versions can't update the installed app. Never commit the file.

2. **Turn it into base64 text:**
   - Linux: `base64 -w0 myweather.jks > myweather.jks.b64`
   - macOS: `base64 -i myweather.jks -o myweather.jks.b64`
   - Windows (PowerShell):
     `[Convert]::ToBase64String([IO.File]::ReadAllBytes("myweather.jks")) | Set-Content myweather.jks.b64`

3. **Add four repository secrets** under **Settings → Secrets and variables → Actions →
   New repository secret**:

   | Name | Value |
   | --- | --- |
   | `ANDROID_KEYSTORE_BASE64` | the whole contents of `myweather.jks.b64` |
   | `ANDROID_KEYSTORE_PASSWORD` | the keystore password |
   | `ANDROID_KEY_ALIAS` | `myweather` |
   | `ANDROID_KEY_PASSWORD` | the key password (same as the keystore password if you pressed Enter) |

   Then delete `myweather.jks.b64`.

4. **Check it:** open **Actions → Android APK → Run workflow** on `main` and leave the tag empty.
   The run fails with a clear message if a secret is missing or the password is wrong,
   and its summary shows the signing certificate. It should no longer say `CN=Android Debug`.

The first APK signed with your key can't install over one signed with the debug key:
uninstall MyWeather once and install the new APK. From then on updates install in place.
