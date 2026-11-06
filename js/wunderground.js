import { DEFAULT_PWS, pwsUrl } from "./pws-stations.js";

const LIST_KEY = "myweather.pws.list";
const ID_RE = /^[A-Z0-9]{3,20}$/;

const select = document.getElementById("pws");
const list = document.getElementById("pws-list");
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
  } catch {}
}

function say(text, error = false) {
  status.textContent = text;
  status.className = error ? "status error" : "status";
}

// Opens the station's Wunderground page in this window. In the Android app it
// opens inside the app with ads blocked, and Back returns here.
function open(station) {
  location.href = pwsUrl(station.id);
}

// Stations are referred to by position, since two nicknames may share an ID.
function render() {
  const placeholder = new Option(
    stations.length ? "Choose a station…" : "No stations yet, add one below",
    ""
  );
  select.replaceChildren(
    placeholder,
    ...stations.map((s, i) => new Option(`${s.name} (${s.id})`, String(i)))
  );
  select.value = "";
  select.disabled = !stations.length;

  list.replaceChildren(
    ...stations.map((s, i) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = pwsUrl(s.id);
      a.textContent = `${s.name} (${s.id})`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "secondary small";
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", `Remove ${s.name}`);
      remove.addEventListener("click", () => {
        stations.splice(i, 1);
        save();
        render();
        say(`Removed ${s.name} (${s.id}).`);
      });
      li.append(a, remove);
      return li;
    })
  );
}

export function initWunderground() {
  stations = load();
  render();

  select.addEventListener("change", () => {
    const s = stations[Number(select.value)];
    if (select.value !== "" && s) open(s);
  });

  // Coming back with the Back button can restore the old selection; reset it
  // so picking the same station again still opens it.
  window.addEventListener("pageshow", () => {
    select.value = "";
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
    save();
    render();
    nameInput.value = idInput.value = "";
    say(`Added ${name} (${id}).`);
  });

  document.getElementById("pws-reset").addEventListener("click", () => {
    stations = DEFAULT_PWS.map((s) => ({ ...s }));
    save();
    render();
    say("Restored the default list.");
  });
}
