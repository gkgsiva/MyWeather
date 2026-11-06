import { DEFAULT_PWS, pwsUrl } from "./pws-stations.js";

const LIST_KEY = "myweather.pws.list";
const SELECTED_KEY = "myweather.pws.selected";
const ID_RE = /^[A-Z0-9]{3,20}$/;

const select = document.getElementById("pws");
const openLink = document.getElementById("pws-open");
const pageLink = document.getElementById("pws-link");
const status = document.getElementById("pws-status");
const nameInput = document.getElementById("pws-name");
const idInput = document.getElementById("pws-id");

let stations = [];

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(LIST_KEY));
    if (Array.isArray(saved)) return saved.filter((s) => s && s.name && ID_RE.test(s.id));
  } catch {}
  return DEFAULT_PWS.map((s) => ({ ...s }));
}

function save() {
  try {
    localStorage.setItem(LIST_KEY, JSON.stringify(stations));
    localStorage.setItem(SELECTED_KEY, select.value);
  } catch {}
}

function say(text, error = false) {
  status.textContent = text;
  status.className = error ? "status error" : "status";
}

// Stations are listed by position, since two nicknames may share an ID.
function fill(selectedIndex) {
  select.replaceChildren(
    ...stations.map((s, i) => new Option(`${s.name} (${s.id})`, String(i)))
  );
  if (stations.length) {
    select.value = String(Math.min(Math.max(selectedIndex, 0), stations.length - 1));
  }
  update();
}

function update() {
  const s = stations[Number(select.value)];
  const has = Boolean(s);
  select.disabled = !has;
  document.getElementById("pws-remove").disabled = !has;
  openLink.classList.toggle("disabled", !has);
  if (has) {
    const url = pwsUrl(s.id);
    openLink.href = pageLink.href = url;
    pageLink.textContent = url;
  } else {
    openLink.removeAttribute("href");
    pageLink.removeAttribute("href");
    pageLink.textContent = "add a station below";
  }
  save();
}

export function initWunderground() {
  stations = load();
  let selected = 0;
  try {
    selected = Number(localStorage.getItem(SELECTED_KEY)) || 0;
  } catch {}
  fill(selected);

  select.addEventListener("change", update);

  document.getElementById("pws-remove").addEventListener("click", () => {
    const i = Number(select.value);
    const [gone] = stations.splice(i, 1);
    fill(i);
    say(`Removed ${gone.name} (${gone.id}).`);
  });

  document.getElementById("pws-add").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    const id = idInput.value.trim().toUpperCase();
    if (!name) return say("Enter a nickname.", true);
    if (!ID_RE.test(id))
      return say("Station IDs are 3 to 20 letters and digits, like ICHENN47.", true);
    if (stations.some((s) => s.id === id && s.name === name))
      return say(`${name} (${id}) is already in the list.`, true);
    stations.push({ name, id });
    fill(stations.length - 1);
    nameInput.value = idInput.value = "";
    say(`Added ${name} (${id}).`);
  });

  document.getElementById("pws-reset").addEventListener("click", () => {
    stations = DEFAULT_PWS.map((s) => ({ ...s }));
    fill(0);
    say("Restored the default list.");
  });
}
