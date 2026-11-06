// Theme button at the bottom of the ☰ menu: Auto (follows the phone) → Dark → Light.
// index.html applies the saved choice before the page draws, to avoid a flash.
const KEY = "myweather.theme";
const ORDER = ["auto", "dark", "light"];
const LABEL = { auto: "Theme: Auto", dark: "☾ Dark", light: "☀ Light" };
const btn = document.getElementById("theme-btn");

function current() {
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

export function initTheme() {
  apply(current());
  btn.addEventListener("click", () => {
    const next = ORDER[(ORDER.indexOf(current()) + 1) % ORDER.length];
    try {
      localStorage.setItem(KEY, next);
    } catch {}
    apply(next);
  });
}
