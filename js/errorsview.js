// Problem log screen (#errors): not in the menu. Opened from the link at the
// bottom of Info, or by tapping the version line on Info five times. Lists
// what js/errlog.js recorded, newest first, and sends it as a text file (or
// copies it) so a problem can be reported with the details.
import { problems, clearProblems, onProblem } from "./errlog.js";
import { shareImage, shareName } from "./share.js";
import { APP_VERSION } from "./version.js";

const $ = (id) => document.getElementById(id);
const KIND = { download: "Download", picture: "Picture", script: "App error" };

function say(text, error = false) {
  const s = $("err-status");
  s.textContent = text;
  s.className = error ? "status error" : "status";
}

const when = (t) =>
  new Date(t).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function shown() {
  const span = $("err-span").value;
  const kind = $("err-kind").value;
  const cut = span === "all" ? 0 : Date.now() - Number(span) * 3600e3;
  return problems().filter((e) => e.last >= cut && (kind === "all" || e.kind === kind));
}

function host(what) {
  try {
    return new URL(what).host;
  } catch {
    return what;
  }
}

function render() {
  const list = shown();
  const all = problems();
  const box = $("err-list");
  $("err-empty").hidden = list.length > 0;
  $("err-empty").textContent = all.length ? "Nothing in this range." : "No problems recorded. Everything the app downloaded worked.";
  // Hosts with the most trouble first.
  const byHost = new Map();
  for (const e of list) {
    if (e.kind === "script") continue;
    const h = host(e.what);
    byHost.set(h, (byHost.get(h) || 0) + (e.count || 1));
  }
  const top = [...byHost].sort((a, b) => b[1] - a[1]).slice(0, 4);
  $("err-summary").textContent = list.length
    ? `${list.reduce((n, e) => n + (e.count || 1), 0)} problems` + (top.length ? `. Most from ${top.map(([h, n]) => `${h} (${n})`).join(", ")}.` : ".")
    : "";
  box.replaceChildren(
    ...list.map((e) => {
      const li = document.createElement("li");
      li.className = `err-row err-${e.kind}`;
      const head = document.createElement("div");
      head.className = "err-head";
      const k = document.createElement("strong");
      k.textContent = KIND[e.kind] || e.kind;
      const t = document.createElement("span");
      t.textContent = `${when(e.last)}${e.count > 1 ? ` · ${e.count} times since ${when(e.at)}` : ""} · ${e.screen}${e.online === false ? " · offline" : ""}`;
      head.append(k, t);
      const why = document.createElement("p");
      why.className = "err-why";
      why.textContent = e.why;
      const what = document.createElement("p");
      what.className = "err-what";
      what.textContent = e.what;
      li.append(head, why, what);
      return li;
    })
  );
}

function asText() {
  const list = shown();
  const lines = [
    `MyWeather problem log · ${APP_VERSION ? `v${APP_VERSION}` : "development copy"} · ${new Date().toLocaleString("en-IN")}`,
    `${navigator.userAgent}`,
    "",
    ...list.map(
      (e) =>
        `${new Date(e.last).toISOString().slice(0, 16).replace("T", " ")} UTC  ${KIND[e.kind] || e.kind}${e.count > 1 ? ` ×${e.count}` : ""}  [${e.screen}]${e.online === false ? " offline" : ""}\n  ${e.why}\n  ${e.what}`
    ),
  ];
  if (!list.length) lines.push("No problems recorded.");
  return lines.join("\n") + "\n";
}

export function initErrors() {
  for (const id of ["err-span", "err-kind"]) $(id).addEventListener("change", render);
  $("err-share").addEventListener("click", async () => {
    try {
      const blob = new Blob([asText()], { type: "text/plain" });
      const how = await shareImage({ blob, name: shareName("problem-log", "text/plain"), text: "MyWeather problem log" });
      if (how === "downloaded") say("Sharing isn't available here, so the log was downloaded.");
    } catch (e) {
      say(`Couldn't share the log (${e.message || e}).`, true);
    }
  });
  $("err-copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(asText());
      say("Copied. Paste it into a message.");
    } catch {
      say("Couldn't copy here. Use Send instead.", true);
    }
  });
  $("err-clear").addEventListener("click", () => {
    clearProblems();
    say("Cleared.");
  });
  onProblem(() => !$("view-errors").hidden && render());
}

export function showErrors() {
  say("");
  render();
}
