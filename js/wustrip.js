// Home: a second strip, in Weather Union's purple, with the neighbourhood
// reading from Weather Union's stations (js/weatherunion.js). Shows the area
// picked here, or the one nearest the phone when location is on.
import { loadWuLatest, wuRainTxt } from "./weatherunion.js";
import { toTemp, tempUnit } from "./prefs.js";

const KEY = "myweather.weatherunion.area";
const $ = (id) => document.getElementById(id);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

function stat(value, label) {
  const s = document.createElement("span");
  s.className = "strip-stat";
  s.innerHTML = "<b></b><small></small>";
  s.querySelector("b").textContent = value;
  s.querySelector("small").textContent = label;
  return s;
}

function show(data) {
  const pick = $("home-wu-area");
  if (!pick.options.length) {
    pick.replaceChildren(...data.readings.map((r) => new Option(r.name, r.name)));
    let saved = "";
    try {
      saved = localStorage.getItem(KEY) || "";
    } catch {}
    pick.value = data.readings.some((r) => r.name === saved) ? saved : data.readings[0].name;
    pick.addEventListener("change", () => {
      try {
        localStorage.setItem(KEY, pick.value);
      } catch {}
      show(data);
    });
  }
  const r = data.readings.find((x) => x.name === pick.value) || data.readings[0];
  $("home-wu-body").replaceChildren(
    stat(isNum(r.temp) ? (+toTemp(r.temp)).toFixed(1) : "–", tempUnit()),
    stat(isNum(r.rainTotal) ? r.rainTotal.toFixed(1) : "–", "mm today"),
    stat(isNum(r.rain) ? (r.rain * 60).toFixed(1) : "–", "mm/h now"),
    stat(isNum(r.humidity) ? `${Math.round(r.humidity)}%` : "–", "humidity")
  );
  $("home-wu-body").classList.toggle("wet", isNum(r.rain) && r.rain > 0);
  const at = new Date(data.at);
  $("home-wu-status").textContent = `Weather Union station nearest ${r.name} · ${wuRainTxt(r)} · read ${at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  $("home-wu").hidden = false;
}

export async function refreshWuStrip() {
  try {
    show(await loadWuLatest());
  } catch {
    // Not published yet or offline with nothing saved: the strip stays hidden.
  }
}
