// Small SVG charts shared by the screens: bars (rain per day or month, rain
// chance per hour) and lines (station rain through a day, the tide curve).
// Tapping a bar or a point shows its text in the readout line under the chart.

const NS = "http://www.w3.org/2000/svg";
export function el(name, attrs = {}, text) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
}

// Rounds the top of the axis up to 1, 2, 2.5 or 5 × 10^n.
export function niceMax(v) {
  if (!(v > 0)) return 10;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v);
}

const W = 360;
const H = 190;
const L = 34;
const R = 6;
const T = 14;
const B = 22;

function axes(svg, y, max, unit, min = 0) {
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.replaceChildren();
  for (let i = 0; i <= 4; i++) {
    const v = min + ((max - min) / 4) * i;
    svg.append(el("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: "grid" }));
    svg.append(el("text", { x: L - 4, y: y(v) + 3, class: "axis", "text-anchor": "end" }, String(+v.toFixed(2))));
  }
  svg.append(el("text", { x: 2, y: 9, class: "axis" }, unit));
}

function selectable(svg, readout, g, text) {
  const show = () => {
    readout.textContent = text;
    for (const s of svg.querySelectorAll(".bar.on")) s.classList.remove("on");
    g.classList.add("on");
  };
  g.addEventListener("click", show);
  g.addEventListener("focus", show);
}

// bars: [{ tick, value (number|null|undefined), partial, text, cls }]
// opts: unit (axis label), max (fixed top), peak (format for the tallest bar's label, or false).
export function drawBars(svg, readout, bars, emptyText, opts = {}) {
  const unit = opts.unit ?? "mm";
  const max = opts.max ?? niceMax(Math.max(0, ...bars.map((b) => b.value || 0)));
  const peak = opts.peak ?? ((v) => v.toFixed(1));
  const step = (W - L - R) / bars.length;
  const bw = Math.max(2, Math.min(22, step - 2));
  const y = (v) => T + (H - T - B) * (1 - Math.min(v, max) / max);
  axes(svg, y, max, unit);

  let top = -1;
  bars.forEach((b, i) => {
    if (typeof b.value === "number" && (top < 0 || b.value > bars[top].value)) top = i;
  });

  bars.forEach((b, i) => {
    const cx = L + step * i + step / 2;
    if (b.tick) svg.append(el("text", { x: cx, y: H - 6, class: "axis", "text-anchor": "middle" }, b.tick));
    const g = el("g", { class: "bar", tabindex: "0", role: "img", "aria-label": b.text });
    // Hit target: the whole column.
    g.append(el("rect", { x: cx - step / 2, y: T, width: step, height: H - T - B, class: "hit" }));
    if (typeof b.value === "number" && b.value > 0) {
      const h = Math.max(1, y(0) - y(b.value));
      const r = Math.min(4, bw / 2, h);
      // Rounded top, square base on the axis.
      const x0 = cx - bw / 2;
      const y0 = y(0);
      const d = `M${x0},${y0}V${y0 - h + r}Q${x0},${y0 - h} ${x0 + r},${y0 - h}H${x0 + bw - r}Q${x0 + bw},${y0 - h} ${x0 + bw},${y0 - h + r}V${y0}Z`;
      g.append(el("path", { d, class: `fill${b.partial ? " partial" : ""}${b.cls ? ` ${b.cls}` : ""}` }));
    } else if (b.value === undefined) {
      g.append(el("rect", { x: cx - bw / 2, y: y(0) - 2, width: bw, height: 2, class: "pending" }));
    }
    selectable(svg, readout, g, b.text);
    svg.append(g);
  });
  svg.append(el("line", { x1: L, x2: W - R, y1: y(0), y2: y(0), class: "baseline" }));

  if (peak && top >= 0 && bars[top].value > 0) {
    const cx = L + step * top + step / 2;
    svg.append(el("text", { x: cx, y: y(bars[top].value) - 4, class: "peak", "text-anchor": "middle" }, peak(bars[top].value)));
  }
  readout.textContent = emptyText;
}

// Lines over a shared x axis of `count` slots.
// series: [{ values: [number|null], cls }]; ticks: [{ at, label }];
// points: [{ at, text }] tap targets (one column each); marks: [{ at, value, label, cls }].
// opts: unit, min, max, now (slot index for a "now" line).
export function drawLines(svg, readout, { count, series, ticks = [], points = [], marks = [] }, emptyText, opts = {}) {
  const all = series.flatMap((s) => s.values).filter((v) => typeof v === "number");
  const min = opts.min ?? 0;
  const max = opts.max ?? niceMax(Math.max(min + 0.001, ...all) - min) + min;
  const step = (W - L - R) / Math.max(1, count - 1);
  const x = (i) => L + step * i;
  const y = (v) => T + (H - T - B) * (1 - (v - min) / (max - min));
  axes(svg, y, max, opts.unit ?? "mm", min);

  for (const t of ticks) svg.append(el("text", { x: x(t.at), y: H - 6, class: "axis", "text-anchor": "middle" }, t.label));
  if (typeof opts.now === "number") {
    svg.append(el("line", { x1: x(opts.now), x2: x(opts.now), y1: T, y2: H - B, class: "now" }));
  }
  for (const s of series) {
    let d = "";
    s.values.forEach((v, i) => {
      if (typeof v !== "number") return;
      d += `${d && typeof s.values[i - 1] === "number" ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    });
    if (d) svg.append(el("path", { d, class: `line ${s.cls || ""}` }));
  }
  for (const m of marks) {
    svg.append(el("circle", { cx: x(m.at), cy: y(m.value), r: 3, class: `mark ${m.cls || ""}` }));
    if (m.label) {
      const above = m.cls !== "low";
      svg.append(
        el("text", { x: x(m.at), y: y(m.value) + (above ? -6 : 13), class: "peak", "text-anchor": "middle" }, m.label)
      );
    }
  }
  for (const p of points) {
    const g = el("g", { class: "bar", tabindex: "0", role: "img", "aria-label": p.text });
    g.append(el("rect", { x: x(p.at) - step / 2, y: T, width: step, height: H - T - B, class: "hit" }));
    selectable(svg, readout, g, p.text);
    svg.append(g);
  }
  svg.append(el("line", { x1: L, x2: W - R, y1: y(min), y2: y(min), class: "baseline" }));
  readout.textContent = emptyText;
}
