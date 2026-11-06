# MyWeather

A small static web app that shows the current India Meteorological Department (IMD)
Doppler weather radar image for a city you pick.

- Choose a **city** (36 IMD radar stations) and a **product** (MAX (Z), PPI, rainfall intensity, etc.).
- The image loads straight from IMD, e.g. `https://mausam.imd.gov.in/Radar/caz_cni.gif` for Chennai,
  and the direct link is shown under it.
- The image refreshes every 10 minutes, or on demand with **Refresh**.
- Your choice is kept in the URL (`?city=cni&product=caz`), so it can be bookmarked or shared.

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

- Publishing a release builds and attaches the APK automatically.
- For a release that already exists, open **Actions → Android APK → Run workflow**
  and enter its tag (e.g. `v1.0`).

To install, download the APK on the phone and allow installs from that source.
Build locally with `cd android && ./gradlew assembleRelease` (needs the Android SDK).

Without signing secrets the APK is signed with a throwaway debug key, so a newer
APK may need the old one uninstalled first. To sign with your own key, add the
repository secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`.
