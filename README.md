# MyWeather

A small static web app for Chennai weather watchers. A home page with a menu leads to:

- **Radars** (`#radar`): the current India Meteorological Department (IMD) Doppler radar image.
  - Choose a **city** (36 IMD radar stations) and a **product** (MAX (Z), PPI, rainfall intensity, etc.).
  - The image loads straight from IMD, e.g. `https://mausam.imd.gov.in/Radar/caz_cni.gif` for Chennai,
    and the direct link is shown under it.
  - There is no auto-refresh; press **Refresh** for the latest image.
  - Chennai is selected by default. **Set as default** saves the current city and product on this device.
  - The choice is kept in the URL (`?city=cni&product=caz#radar`), so it can be bookmarked or shared.
- **Wunderground** (`#wunderground`): picking a station opens its Wunderground dashboard right away (Back returns).
  The dropdown shows `Nickname (ID)`; add or remove any number of stations (saved on this device).
  The default list is in [`js/pws-stations.js`](js/pws-stations.js).
- **Kea Blog** (`#blog`): the latest posts from [kwschennai.com/blog](https://kwschennai.com/blog/)
  (read from the site's WordPress feed), and a button to open the blog.

Wunderground and the blog are third-party sites with ads. On the website they open in a new tab with
their ads. In the Android app they open inside the app, with requests to common ad servers blocked.

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
