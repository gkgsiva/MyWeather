# MyWeather

A small static web app for Chennai weather watchers. A home page and the ☰ menu in the header bar lead to:

- **Forecast** (`#forecast`): Chennai's weather now, the chance of rain for each of the next 24 hours, and
  7 days ahead (high/low, rain chance, expected mm, wind). From [Open-Meteo](https://open-meteo.com/)
  (`api.open-meteo.com`, no key), which blends ECMWF, GFS and other models.
- **Radars** (`#radar`): the current India Meteorological Department (IMD) Doppler radar image.
  - Choose a **city** (36 IMD radar stations) and a **product** (MAX (Z), PPI, rainfall intensity, etc.).
  - The image loads straight from IMD, e.g. `https://mausam.imd.gov.in/Radar/caz_cni.gif` for Chennai,
    and the direct link is shown under it.
  - There is no auto-refresh; press **Refresh** for the latest image.
  - Chennai is selected by default. **Set as default** saves the current city and product on this device.
  - The choice is kept in the URL (`?city=cni&product=caz#radar`), so it can be bookmarked or shared.
  - **Play last 3 hours** swaps in IMD's radar loop (MAX (Z) and Surface Rainfall Intensity only),
    e.g. `https://mausam.imd.gov.in/Radar/animation/Converted/CNI_MAXZ.gif`; kept in the URL as `&anim=1`.
- **Satellite** (`#satellite`): IMD's INSAT pictures (Asia sector, full disc) and loops, from
  `https://mausam.imd.gov.in/Satellite/`.
- **Warnings** (`#warnings`): IMD's district-wise nowcast (next 3 hours) and 5-day warnings for Tamil Nadu and
  Puducherry, as a map and a district list (Chennai first). Both come from IMD's GeoServer at
  `reactjs.imd.gov.in`; the list needs the Android app, which adds the missing CORS header.
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
- **Rain history** (`#rain`): every saved station's rain for the last 7 days side by side, and per station
  (`#rain?id=ICHENN47&month=2026-11`) a daily chart for a month and a monthly chart for the last 12 months.
  The data is Wunderground's (`api.weather.com` `dailysummary/7day` and `history/daily`, with the same key as
  the dashboard). History comes one day per request, so each finished day is kept on the phone and only
  today is fetched again; requests are spaced about 2 seconds apart to stay inside the key's limits.
- **Compare stations** (`#compare?ids=ICHENN47,ICHENNAI1&day=2026-11-05` or `&month=2026-10`): two or three
  stations' rain as running totals through a day (every reading of the day, `history/all` or
  `observations/all/1day`, one request per station) or a month (the daily totals Rain history keeps on the
  phone, fetching only missing days).
- **Station map** (`#map`): every saved station on an OpenStreetMap map, marked and coloured by rain today
  (IMD's daily bands), rain rate or temperature; tap one for its readings and links. Positions come with the
  readings and are kept on the phone. [Leaflet](https://leafletjs.com/) 1.9.4 is bundled in `js/vendor/leaflet`
  (BSD-2 licence). The Android app fetches the tiles with its own User-Agent, as OpenStreetMap's tile policy asks.
- **Lakes** (`#lakes`): storage in Chennai's reservoirs, read from Chennai Metro Water's
  [lake-level page](https://cmwssb.tn.gov.in/lakelevel) (percent full when the table has capacity and
  storage columns). **Open Metro Water page** shows the page itself under the menu.
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

**Offline:** the last radar image for each city and product, the station readings and positions, the cyclone
list, the lake table, and the last forecast, monsoon figures, air quality and sea forecast are kept on the phone and shown, with the time they were saved, when the network drops.

**Dark mode:** the theme follows the phone; the **Theme** button at the bottom of the menu (☰) switches between Auto, Dark and Light.

The app is meant for the Android app on a phone. Wunderground pages can only be shown in a frame there:
the app drops Wunderground's no-framing headers and blocks requests to common ad servers.

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
