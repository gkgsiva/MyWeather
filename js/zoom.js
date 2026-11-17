// Pinch to zoom (and double-tap) for a block that isn't a Leaflet map: Model
// charts' side-by-side maps and its line and bar charts.
//
// The box clips; its first child is scaled with a CSS transform. Not zoomed,
// one finger scrolls the page as usual; two fingers zoom around the point
// between them. Zoomed, one finger pans. A double tap zooms in 2.5× at that
// point, or back out. The small + / − / Reset buttons do the same without
// gestures and are left out of shared pictures (snap-skip), so a share shows
// what is on screen.

const MAX = 5;

export function makeZoomable(box, { max = MAX } = {}) {
  const inner = box.firstElementChild;
  box.classList.add("zoom-box");
  inner.classList.add("zoom-inner");
  // The picture is clipped; the buttons sit under it, outside the zoomed part.
  const clip = document.createElement("div");
  clip.className = "zoom-clip";
  box.prepend(clip);
  clip.append(inner);
  let s = 1;
  let tx = 0;
  let ty = 0;

  const tools = document.createElement("div");
  tools.className = "zoom-tools snap-skip";
  tools.innerHTML =
    '<button type="button" class="secondary small" data-z="in" aria-label="Zoom in">+</button>' +
    '<button type="button" class="secondary small" data-z="out" aria-label="Zoom out">−</button>' +
    '<button type="button" class="secondary small" data-z="reset" hidden>Reset</button>';
  box.append(tools);
  const resetBtn = tools.querySelector('[data-z="reset"]');

  function clamp() {
    const w = clip.clientWidth;
    const h = clip.clientHeight;
    s = Math.min(max, Math.max(1, s));
    tx = Math.min(0, Math.max(w - w * s, tx));
    ty = Math.min(0, Math.max(h - h * s, ty));
  }
  function apply() {
    clamp();
    inner.style.transform = s === 1 ? "" : `translate(${tx}px, ${ty}px) scale(${s})`;
    const zoomed = s > 1.001;
    box.classList.toggle("zoomed", zoomed);
    resetBtn.hidden = !zoomed;
  }
  // Zooms to scale ns keeping the box point (px, py) still.
  function zoomAt(ns, px, py) {
    ns = Math.min(max, Math.max(1, ns));
    tx = px - ((px - tx) / s) * ns;
    ty = py - ((py - ty) / s) * ns;
    s = ns;
    apply();
  }
  const reset = () => {
    s = 1;
    tx = ty = 0;
    apply();
  };

  tools.addEventListener("click", (e) => {
    const z = e.target.closest("[data-z]")?.dataset.z;
    if (!z) return;
    const cx = clip.clientWidth / 2;
    const cy = clip.clientHeight / 2;
    if (z === "in") zoomAt(s * 1.6, cx, cy);
    else if (z === "out") zoomAt(s / 1.6, cx, cy);
    else reset();
  });

  const local = (t) => {
    const r = clip.getBoundingClientRect();
    return [t.clientX - r.left, t.clientY - r.top];
  };
  let pinch = null; // { d, s, mid }
  let pan = null; // [x, y]
  let moved = false;
  let lastTap = null; // { at, x, y }

  clip.addEventListener(
    "touchstart",
    (e) => {
      if (e.target.closest(".zoom-tools")) return;
      if (e.touches.length === 2) {
        const a = local(e.touches[0]);
        const b = local(e.touches[1]);
        pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, s, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], tx, ty };
        pan = null;
        moved = true;
      } else if (e.touches.length === 1) {
        pan = local(e.touches[0]);
        moved = false;
      }
    },
    { passive: true }
  );
  clip.addEventListener(
    "touchmove",
    (e) => {
      if (pinch && e.touches.length === 2) {
        const a = local(e.touches[0]);
        const b = local(e.touches[1]);
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        // Scale around where the pinch began, then follow the fingers.
        s = pinch.s;
        tx = pinch.tx + (mid[0] - pinch.mid[0]);
        ty = pinch.ty + (mid[1] - pinch.mid[1]);
        zoomAt((pinch.s * d) / pinch.d, mid[0], mid[1]);
        if (e.cancelable) e.preventDefault();
      } else if (pan && e.touches.length === 1 && s > 1.001) {
        const p = local(e.touches[0]);
        tx += p[0] - pan[0];
        ty += p[1] - pan[1];
        if (Math.abs(p[0] - pan[0]) + Math.abs(p[1] - pan[1]) > 1) moved = true;
        pan = p;
        apply();
        if (e.cancelable) e.preventDefault();
      } else if (pan && e.touches.length === 1) {
        const p = local(e.touches[0]);
        if (Math.abs(p[0] - pan[0]) + Math.abs(p[1] - pan[1]) > 8) moved = true;
      }
    },
    { passive: false }
  );
  clip.addEventListener(
    "touchend",
    (e) => {
      if (e.touches.length === 0) {
        if (pan && !moved && !pinch) {
          const now = Date.now();
          const [x, y] = pan;
          if (lastTap && now - lastTap.at < 320 && Math.hypot(x - lastTap.x, y - lastTap.y) < 30) {
            if (s > 1.001) reset();
            else zoomAt(2.5, x, y);
            lastTap = null;
            if (e.cancelable) e.preventDefault();
          } else lastTap = { at: now, x, y };
        }
        pinch = null;
        pan = null;
      } else if (e.touches.length === 1) {
        // One finger left after a pinch: carry on panning from it.
        pinch = null;
        pan = local(e.touches[0]);
      }
    },
    { passive: false }
  );
  clip.addEventListener("dblclick", (e) => {
    // Mouse (or a phone that sends dblclick): same as a double tap.
    if (e.target.closest(".zoom-tools")) return;
    const [x, y] = local(e);
    if (s > 1.001) reset();
    else zoomAt(2.5, x, y);
  });
  window.addEventListener("resize", apply);
  return { reset, get scale() { return s; } };
}
