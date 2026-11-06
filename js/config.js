// Build-time settings. Keep secrets out of git: the Android APK workflow fills
// WEATHER_API_KEY from the repository secret of the same name before building.
// Without it, the key can be entered on the Wunderground screen (saved on the phone).
export const WEATHER_API_KEY = "";
