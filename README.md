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
