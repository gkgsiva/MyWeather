// Pull to refresh: at the top of a screen, drag down and let go to reload it.
//
// Touches on the page itself are followed here. Pages shown in a frame
// (Wunderground, the blog, CPCB, Metro Water) get a few lines from the
// Android app (FrameProxy) that post their touches to this page as
// { myweather: "pull", phase, y, href }, so pulling works on them too.
// The station map is left alone: dragging it down pans the map.

const TRIGGER = 70; // px of (damped) pull that triggers a refresh
const MAX = 110;
const MIN_SPIN_MS = 900;

export function initPullToRefresh(onRefresh, { canStart = () => true } = {}) {
  const ind = document.createElement("div");
  ind.className = "ptr";
  ind.setAttribute("aria-hidden", "true");
  ind.innerHTML =
    '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M20 12a8 8 0 1 1-2.34-5.66" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M20 4v5h-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  document.body.append(ind);
  const live = document.createElement("p");
  live.className = "visually-hidden";
  live.setAttribute("aria-live", "polite");
  document.body.append(live);

  let startY = null;
  let startX = 0;
  let pull = 0;
  let busy = false;

  const damp = (dy) => Math.min(MAX, dy * 0.55);

  function draw() {
    ind.style.transform = `translate(-50%, ${pull - 52}px) rotate(${pull * 3.2}deg)`;
    ind.style.opacity = String(Math.min(1, pull / 40));
    ind.classList.toggle("ready", pull >= TRIGGER);
  }

  function reset() {
    startY = null;
    pull = 0;
    ind.classList.add("settle");
    draw();
  }

  function begin(y, x = 0) {
    if (busy) return;
    startY = y;
    startX = x;
    pull = 0;
    ind.classList.remove("settle", "spin");
  }

  // Returns true while the gesture is a pull (so the page shouldn't scroll).
  function move(y, x = startX) {
    if (startY === null) return false;
    const dy = y - startY;
    if (pull === 0 && (dy <= 0 || Math.abs(x - startX) > dy)) {
      // Scrolling up or sideways: not a pull.
      if (dy < -4 || Math.abs(x - startX) > 10) startY = null;
      return false;
    }
    pull = damp(Math.max(0, dy));
    draw();
    return true;
  }

  async function end(href) {
    if (startY === null) return;
    if (pull < TRIGGER) return reset();
    startY = null;
    busy = true;
    pull = TRIGGER;
    ind.classList.add("settle", "spin");
    draw();
    live.textContent = "Refreshing";
    const started = Date.now();
    try {
      await onRefresh({ href });
    } catch {}
    const wait = MIN_SPIN_MS - (Date.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    busy = false;
    ind.classList.remove("spin");
    reset();
  }

  document.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length !== 1 || window.scrollY > 0 || !canStart(e.target)) {
        startY = null;
        return;
      }
      begin(e.touches[0].clientY, e.touches[0].clientX);
    },
    { passive: true }
  );
  document.addEventListener(
    "touchmove",
    (e) => {
      if (e.touches.length !== 1) return reset();
      const t = e.touches[0];
      if (move(t.clientY, t.clientX) && e.cancelable) e.preventDefault();
    },
    { passive: false }
  );
  document.addEventListener("touchend", () => end(), { passive: true });
  document.addEventListener("touchcancel", reset, { passive: true });

  // Touches inside a framed page, posted by FrameProxy's script. Only our
  // own frames are listened to.
  window.addEventListener("message", (e) => {
    const d = e.data;
    if (!d || d.myweather !== "pull") return;
    const frame = [...document.querySelectorAll("iframe")].find((f) => f.contentWindow === e.source);
    if (!frame || frame.offsetParent === null) return;
    const top = frame.getBoundingClientRect().top;
    if (d.phase === "start") {
      if (window.scrollY > 0) return;
      begin(top + d.y);
    } else if (d.phase === "move") move(top + d.y);
    else if (d.phase === "end") end(typeof d.href === "string" ? d.href : "");
    else reset();
  });
}
