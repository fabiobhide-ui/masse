// Schlanke SVG-Diagramme ohne externe Bibliothek (offline-fähig).
const W = 340, H = 180, P = { l: 38, r: 10, t: 12, b: 24 };
const fmt = (v, d = 0) => v.toLocaleString('de-DE', { maximumFractionDigits: d, minimumFractionDigits: d });
const shortDate = d => d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });

function niceRange(min, max, pad = 0.08) {
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  return [min - span * pad, max + span * pad];
}
function ticks(min, max, n = 4) {
  return Array.from({ length: n }, (_, i) => min + ((max - min) * i) / (n - 1));
}
function frame(xMin, xMax, yMin, yMax, decimals, body, xLabels) {
  const x = v => P.l + ((v - xMin) / (xMax - xMin || 1)) * (W - P.l - P.r);
  const y = v => H - P.b - ((v - yMin) / (yMax - yMin || 1)) * (H - P.t - P.b);
  const grid = ticks(yMin, yMax).map(v =>
    `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" class="grid"/>` +
    `<text x="${P.l - 6}" y="${y(v) + 4}" text-anchor="end" class="axis">${fmt(v, decimals)}</text>`).join('');
  const xl = (xLabels ?? []).map(([v, label], i, arr) =>
    `<text x="${x(v)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === arr.length - 1 ? 'end' : 'middle'}" class="axis">${label}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img">${grid}${xl}${body(x, y)}</svg>`;
}
const empty = text => `<div class="chart-empty">${text}</div>`;

/** Linien: series = [{points:[{x:Date,y:number}], cls, dots, label}] ; goal optional */
export function lineChart(series, { decimals = 1, goal = null, emptyText = 'Noch keine Daten' } = {}) {
  const all = series.flatMap(s => s.points);
  if (all.length === 0) return empty(emptyText);
  const xs = all.map(p => +p.x), ys = all.map(p => p.y).concat(goal != null ? [goal] : []);
  let xMin = Math.min(...xs), xMax = Math.max(...xs);
  if (xMin === xMax) { xMin -= 86400000; xMax += 86400000; }
  const [yMin, yMax] = niceRange(Math.min(...ys), Math.max(...ys));
  const labels = [[xMin, shortDate(new Date(xMin))], [xMax, shortDate(new Date(xMax))]];
  const legend = series.filter(s => s.label).map(s => `<span class="lg ${s.cls}">${s.label}</span>`).join('')
    + (goal != null ? `<span class="lg goal">Ziel</span>` : '');
  return frame(xMin, xMax, yMin, yMax, decimals, (x, y) => {
    let out = goal != null ? `<line x1="${P.l}" x2="${W - P.r}" y1="${y(goal)}" y2="${y(goal)}" class="goal"/>` : '';
    for (const s of series) {
      if (!s.points.length) continue;
      const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${x(+p.x).toFixed(1)},${y(p.y).toFixed(1)}`).join('');
      out += `<path d="${d}" class="line ${s.cls}"/>`;
      if (s.dots) out += s.points.map(p => `<circle cx="${x(+p.x)}" cy="${y(p.y)}" r="2.6" class="dot ${s.cls}"/>`).join('');
    }
    return out;
  }, labels) + (legend ? `<div class="legend">${legend}</div>` : '');
}

/** Balken je Tag: bars = [{x:Date, y:number}] */
export function barChart(bars, { goal = null, cls = '', decimals = 0, emptyText = 'Noch keine Daten' } = {}) {
  if (!bars.length || bars.every(b => !b.y)) return empty(emptyText);
  const yMax = Math.max(...bars.map(b => b.y), goal ?? 0) * 1.1 || 1;
  const n = bars.length;
  const labels = [[0, shortDate(bars[0].x)], [n - 1, shortDate(bars[n - 1].x)]];
  return frame(-0.5, n - 0.5, 0, yMax, decimals, (x, y) => {
    const bw = Math.max(1.5, ((W - P.l - P.r) / n) * 0.7);
    let out = bars.map((b, i) => b.y > 0
      ? `<rect x="${x(i) - bw / 2}" y="${y(b.y)}" width="${bw}" height="${Math.max(0, y(0) - y(b.y))}" rx="${Math.min(3, bw / 2)}" class="bar ${cls}"/>` : '').join('');
    if (goal != null) out += `<line x1="${P.l}" x2="${W - P.r}" y1="${y(goal)}" y2="${y(goal)}" class="goal"/>`;
    return out;
  }, labels.map(([i, l]) => [i, l])) + (goal != null ? `<div class="legend"><span class="lg goal">Ziel</span></div>` : '');
}

/** Ring für Makroverteilung: parts = [{value, cls, label}] */
export function donut(parts) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (!total) return empty('Noch keine Einträge im Zeitraum');
  const r = 46, c = 2 * Math.PI * r;
  let off = 0;
  const arcs = parts.map(p => {
    const len = (p.value / total) * c;
    const s = `<circle r="${r}" cx="60" cy="60" fill="none" stroke-width="16" class="arc ${p.cls}" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-off}" transform="rotate(-90 60 60)"/>`;
    off += len; return s;
  }).join('');
  const legend = parts.map(p => `<div class="lg ${p.cls}">${p.label} <b>${fmt((p.value / total) * 100)} %</b></div>`).join('');
  return `<div class="donut"><svg viewBox="0 0 120 120" width="120" height="120">${arcs}</svg><div>${legend}</div></div>`;
}
