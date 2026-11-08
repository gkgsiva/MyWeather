// Theme button at the bottom of the ☰ menu: Auto (follows the phone) → Dark → Light.
// index.html applies the saved choice before the page draws, to avoid a flash.
const KEY = "myweather.theme";
const ORDER = ["auto", "dark", "light"];
const LABEL = { auto: "Theme: Auto", dark: "☾ Dark", light: "☀ Light" };
const btn = document.getElementById("theme-btn");

export function currentTheme() {
  try {
    const t = localStorage.getItem(KEY);
    return ORDER.includes(t) ? t : "auto";
  } catch {
    return "auto";
  }
}

function apply(theme) {
  if (theme === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  btn.textContent = LABEL[theme];
  btn.title = theme === "auto" ? "Theme follows the phone. Tap for Dark." : `Theme: ${theme}. Tap to change.`;
}

/** Sets "auto", "dark" or "light" (also from the Settings screen). */
export function setTheme(theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {}
  apply(theme);
  window.dispatchEvent(new Event("myweather:theme"));
}

export function initTheme() {
  apply(currentTheme());
  btn.addEventListener("click", () => {
    setTheme(ORDER[(ORDER.indexOf(currentTheme()) + 1) % ORDER.length]);
  });
}
