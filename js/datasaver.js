// Data saver: the combined radar normally downloads every radar's 3-hour loop
// (about 16 MB). With the saver on, it reads each radar's latest picture
// instead (about 0.8 MB in all) and lifts the rain out with the bare map
// saved from the last full download; storm motion comes from that download
// too (if under 2 hours old). "Auto" saves on mobile data or when the phone's
// own data saver is on (where the phone tells the app).
const KEY = "myweather.datasaver"; // "auto" | "on" | "off"

export function saverMode() {
  try {
    const v = localStorage.getItem(KEY);
    return v === "on" || v === "off" ? v : "auto";
  } catch {
    return "auto";
  }
}

export function setSaverMode(v) {
  try {
    localStorage.setItem(KEY, v);
  } catch {}
  for (const sel of document.querySelectorAll("select[data-saver]")) sel.value = v;
}

export function onMobileData() {
  const c = navigator.connection;
  return !!c && (c.saveData === true || c.type === "cellular");
}

/** Whether to save data right now. */
export const savingData = () => saverMode() === "on" || (saverMode() === "auto" && onMobileData());

/** Wires a <select data-saver> (Auto / Saver / Full) to the shared setting. */
export function bindSaver(sel, onChange) {
  sel.replaceChildren(
    new Option("Auto (saver on mobile data)", "auto"),
    new Option("Data saver (0.8 MB)", "on"),
    new Option("Full loops (16 MB)", "off")
  );
  sel.value = saverMode();
  sel.addEventListener("change", () => {
    setSaverMode(sel.value);
    onChange?.();
  });
}
