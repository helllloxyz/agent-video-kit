import {C, clamp, smooth, lerp, drawMath, drawText, mathBounds, line, arrow, dot, rect} from './lib.mjs';

export const R = (T, i, d = 1, off = 0) => smooth((T.b(i) - off) / d);
export const phase = (T, a, b = null, d = 0.6) => R(T, a, d) * (b == null ? 1 : 1 - R(T, b, d));

// Thin spaces around the conditional bar, so "AB|C" reads like typeset math.
const bar = (s) => s.replace(/\|/g, '\\,|\\,');
export const dm = (c, s, x, y, o) => drawMath(c, bar(s), x, y, o);
export const db = (s, x, y, o) => mathBounds(bar(s), x, y, o);

export function rng(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function card(c, cx, top, w, h, alpha, color = C.grey, fill = '#141418') {
  rect(c, cx - w / 2, top, w, h, { stroke: color, width: 2.5, alpha: alpha * 0.9, r: 14, fill });
}

export function pill(c, s, x, y, color, alpha, size = 30) {
  if (alpha <= 0) return;
  const w = [...s].length * size + 50;
  rect(c, x - w / 2, y - size * 0.95, w, size * 1.9, { fill: color + '22', stroke: color, width: 2, alpha, r: size * 0.95 });
  drawText(c, s, x, y, { size, color, alpha });
}

export function boxAround(c, b, alpha, color = C.yellow, pad = 24, prog = 1) {
  if (alpha <= 0) return;
  rect(c, b.x - pad, b.top - pad, (b.w + pad * 2) * prog, b.bottom - b.top + pad * 2, { stroke: color, width: 3, alpha, r: 10 });
}

export function cross(c, x, y, s, alpha, color = C.red, prog = 1) {
  line(c, x - s, y - s, x + s, y + s, { color, width: 6, alpha, prog: clamp(prog * 2) });
  line(c, x + s, y - s, x - s, y + s, { color, width: 6, alpha, prog: clamp(prog * 2 - 1) });
}

export function check(c, x, y, s, alpha, color = C.green, prog = 1) {
  line(c, x - s, y, x - s * 0.3, y + s * 0.7, { color, width: 7, alpha, prog: clamp(prog * 2) });
  line(c, x - s * 0.3, y + s * 0.7, x + s, y - s * 0.8, { color, width: 7, alpha, prog: clamp(prog * 2 - 1) });
}

// ---------- icons ----------
export function cloud(c, x, y, s, alpha, color = C.blue) {
  if (alpha <= 0) return;
  c.save(); c.globalAlpha = alpha * 0.85; c.fillStyle = color;
  c.beginPath();
  for (const [dx, dy, r] of [[-0.42, 0.12, 0.26], [-0.12, -0.1, 0.36], [0.26, 0.0, 0.3], [0.5, 0.16, 0.2]]) {
    c.moveTo(x + (dx + r) * s, y + dy * s); c.arc(x + dx * s, y + dy * s, r * s, 0, Math.PI * 2);
  }
  c.rect(x - 0.42 * s, y + 0.05 * s, 0.92 * s, 0.31 * s);
  c.fill(); c.restore();
}

export function wind(c, x, y, s, alpha, t = 0) {
  if (alpha <= 0) return;
  c.save(); c.globalAlpha = alpha; c.strokeStyle = C.white; c.lineWidth = 3; c.lineCap = 'round';
  [0, 1, 2].forEach((k) => {
    const yy = y + k * s * 0.22, len = s * (0.9 - k * 0.2), sh = Math.sin(t * 2 + k) * s * 0.05;
    c.beginPath(); c.moveTo(x - len / 2 + sh, yy);
    c.lineTo(x + len / 2 + sh, yy);
    c.arc(x + len / 2 + sh, yy - s * 0.08, s * 0.08, Math.PI / 2, -Math.PI * 0.9, true);
    c.stroke();
  });
  c.restore();
}

const PIPS = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] };
export function die(c, x, y, s, n, rot, alpha, color = C.white) {
  if (alpha <= 0) return;
  c.save(); c.globalAlpha = alpha; c.translate(x, y); c.rotate(rot);
  c.beginPath(); c.roundRect(-s / 2, -s / 2, s, s, s * 0.16);
  c.fillStyle = '#1c1c22'; c.fill(); c.strokeStyle = color; c.lineWidth = Math.max(2, s / 30); c.stroke();
  c.fillStyle = color;
  for (const [px, py] of PIPS[n]) { c.beginPath(); c.arc(px * s * 0.27, py * s * 0.27, s * 0.085, 0, Math.PI * 2); c.fill(); }
  c.restore();
}

export function coin(c, x, y, r, label, alpha, squash = 1, color = C.gold) {
  if (alpha <= 0) return;
  c.save(); c.globalAlpha = alpha; c.translate(x, y); c.scale(1, Math.max(0.05, Math.abs(squash)));
  c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fillStyle = color + '44'; c.fill();
  c.strokeStyle = color; c.lineWidth = 3; c.stroke();
  c.beginPath(); c.arc(0, 0, r * 0.78, 0, Math.PI * 2); c.lineWidth = 1.5; c.stroke();
  c.restore();
  if (label && Math.abs(squash) > 0.5) drawText(c, label, x, y + 2, { size: r * 0.9, color, alpha });
}

export function cup(c, x, y, s, alpha) {
  if (alpha <= 0) return;
  c.save(); c.globalAlpha = alpha;
  c.beginPath(); c.moveTo(x - s * 0.62, y); c.lineTo(x - s * 0.42, y - s * 1.0); c.lineTo(x + s * 0.42, y - s * 1.0); c.lineTo(x + s * 0.62, y); c.closePath();
  c.fillStyle = '#2a2a33'; c.fill(); c.strokeStyle = C.grey; c.lineWidth = 3; c.stroke();
  c.restore();
  drawText(c, '?', x, y - s * 0.5, { size: s * 0.6, color: C.yellow, alpha, kind: 'up' });
}

export function ship(c, x, y, s, alpha, t = 0) {
  if (alpha <= 0) return;
  const bob = Math.sin(t * 1.6) * s * 0.03;
  c.save(); c.globalAlpha = alpha; c.translate(x, y + bob); c.rotate(Math.sin(t * 1.3) * 0.04);
  c.beginPath(); c.moveTo(-s * 0.6, 0); c.lineTo(s * 0.6, 0); c.lineTo(s * 0.42, s * 0.25); c.lineTo(-s * 0.45, s * 0.25); c.closePath();
  c.fillStyle = C.gold + '55'; c.fill(); c.strokeStyle = C.gold; c.lineWidth = 3; c.stroke();
  c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -s * 0.85); c.strokeStyle = C.white; c.stroke();
  c.beginPath(); c.moveTo(s * 0.04, -s * 0.8); c.lineTo(s * 0.48, -s * 0.12); c.lineTo(s * 0.04, -s * 0.12); c.closePath();
  c.fillStyle = C.white + 'cc'; c.fill();
  c.beginPath(); c.moveTo(-s * 0.04, -s * 0.65); c.lineTo(-s * 0.4, -s * 0.12); c.lineTo(-s * 0.04, -s * 0.12); c.closePath();
  c.fillStyle = C.white + '88'; c.fill();
  c.restore();
  c.save(); c.globalAlpha = alpha; c.strokeStyle = C.blue; c.lineWidth = 3; c.beginPath();
  for (let i = 0; i <= 60; i++) { const px = x - s * 0.9 + i / 60 * s * 1.8, py = y + s * 0.3 + Math.sin(i / 60 * 12 + t * 2) * s * 0.03; i ? c.lineTo(px, py) : c.moveTo(px, py); }
  c.stroke(); c.restore();
}

export function eye(c, x, y, s, iris, alpha) {
  if (alpha <= 0) return;
  c.save(); c.globalAlpha = alpha;
  c.beginPath(); c.moveTo(x - s, y); c.quadraticCurveTo(x, y - s * 0.75, x + s, y); c.quadraticCurveTo(x, y + s * 0.75, x - s, y); c.closePath();
  c.fillStyle = '#e8e8e8'; c.fill(); c.save(); c.clip();
  c.beginPath(); c.arc(x, y, s * 0.36, 0, Math.PI * 2); c.fillStyle = iris; c.fill();
  c.beginPath(); c.arc(x, y, s * 0.15, 0, Math.PI * 2); c.fillStyle = '#111'; c.fill();
  c.beginPath(); c.arc(x + s * 0.1, y - s * 0.12, s * 0.06, 0, Math.PI * 2); c.fillStyle = '#fff'; c.fill();
  c.restore();
  c.strokeStyle = C.white; c.lineWidth = 3;
  c.beginPath(); c.moveTo(x - s, y); c.quadraticCurveTo(x, y - s * 0.75, x + s, y); c.quadraticCurveTo(x, y + s * 0.75, x - s, y); c.stroke();
  c.restore();
}

export function lightning(c, x, y, s, alpha) {
  if (alpha <= 0) return;
  c.save(); c.globalAlpha = alpha; c.fillStyle = C.yellow;
  c.beginPath(); c.moveTo(x + s * 0.15, y - s); c.lineTo(x - s * 0.35, y + s * 0.1); c.lineTo(x - s * 0.02, y + s * 0.1);
  c.lineTo(x - s * 0.15, y + s); c.lineTo(x + s * 0.35, y - s * 0.12); c.lineTo(x + s * 0.02, y - s * 0.12); c.closePath(); c.fill();
  c.restore();
}

// True/false toggle; state 0 = 假, 1 = 真.
export function tfSwitch(c, x, y, state, alpha, w = 240, h = 74) {
  if (alpha <= 0) return;
  rect(c, x - w / 2, y - h / 2, w, h, { fill: '#1b1b20', stroke: C.grey, width: 2.5, alpha, r: h / 2 });
  const kx = lerp(x - w / 4, x + w / 4, 1 - state), col = state > 0.5 ? C.green : C.red;
  rect(c, kx - w / 4 + 6, y - h / 2 + 6, w / 2 - 12, h - 12, { fill: col + '66', stroke: col, width: 2, alpha, r: h / 2 - 6 });
  drawText(c, '真', x - w / 4, y, { size: 34, color: state > 0.5 ? C.white : C.grey, alpha });
  drawText(c, '假', x + w / 4, y, { size: 34, color: state <= 0.5 ? C.white : C.grey, alpha });
}

// Venn diagram; fills = { and, or, not } alphas.
export function venn(c, cx, cy, alpha, fills = {}, r = 140) {
  if (alpha <= 0) return;
  const A = [cx - 75, cy], B = [cx + 75, cy], uw = 620, uh = 400;
  c.save(); c.globalAlpha = alpha;
  const circ = (P) => { c.moveTo(P[0] + r, P[1]); c.arc(P[0], P[1], r, 0, Math.PI * 2); };
  if (fills.and > 0) { c.save(); c.globalAlpha = alpha * fills.and; c.beginPath(); circ(A); c.clip(); c.beginPath(); circ(B); c.fillStyle = C.yellow + '88'; c.fill(); c.restore(); }
  if (fills.or > 0) { c.save(); c.globalAlpha = alpha * fills.or; c.beginPath(); circ(A); circ(B); c.fillStyle = C.green + '77'; c.fill('nonzero'); c.restore(); }
  if (fills.not > 0) { c.save(); c.globalAlpha = alpha * fills.not; c.beginPath(); c.rect(cx - uw / 2, cy - uh / 2, uw, uh); circ(A); c.fillStyle = C.red + '66'; c.fill('evenodd'); c.restore(); }
  c.strokeStyle = C.grey; c.lineWidth = 2.5; c.strokeRect(cx - uw / 2, cy - uh / 2, uw, uh);
  c.lineWidth = 3.5; c.strokeStyle = C.blue; c.beginPath(); circ(A); c.stroke();
  c.strokeStyle = C.green; c.beginPath(); circ(B); c.stroke();
  c.restore();
  drawMath(c, 'A', A[0] - r * 0.95, cy - r * 0.8, { size: 46, color: C.blue, alpha });
  drawMath(c, 'B', B[0] + r * 0.95, cy - r * 0.8, { size: 46, color: C.green, alpha });
}

// Number line on [0, 1].
export function unitLine(c, x0, x1, y, alpha, o = {}) {
  const { prog = 1, color = C.grey, labels = true, size = 38 } = o;
  if (alpha <= 0) return;
  line(c, x0, y, lerp(x0, x1, prog), y, { color, width: 4, alpha });
  if (prog < 1) return;
  for (const [v, s] of [[0, '0'], [1, '1']]) {
    const X = lerp(x0, x1, v); line(c, X, y - 16, X, y + 16, { color: C.white, width: 3, alpha });
    if (labels) drawMath(c, s, X, y + 58, { size, alpha });
  }
  for (let k = 1; k < 10; k++) { const X = lerp(x0, x1, k / 10); line(c, X, y - 8, X, y + 8, { color, width: 2, alpha: alpha * 0.7 }); }
}

// Rectangle partition with caller-defined labels.
export function areaSquare(c, x, y, s, bw, ah, alpha, o = {}) {
  const { stripA = 1, labels = true, wLabel = 'w', hLabel = 'h', areaLabel = '', totalLabel = '', showA = 1, bCol = C.green, aCol = C.yellow } = o;
  if (alpha <= 0) return;
  rect(c, x, y, s, s, { fill: '#141418', stroke: C.white, width: 3, alpha });
  rect(c, x, y, s * bw, s, { fill: bCol + '40', stroke: bCol, width: 2.5, alpha: alpha * stripA });
  if (showA > 0) rect(c, x, y + s * (1 - ah), s * bw, s * ah, { fill: aCol + '77', stroke: aCol, width: 2.5, alpha: alpha * showA });
  if (totalLabel) drawMath(c, totalLabel, x + s - 30, y + 46, { size: 38, color: C.grey, alpha });
  if (!labels) return;
  line(c, x, y + s + 30, x + s * bw, y + s + 30, { color: bCol, width: 3, alpha: alpha * stripA });
  line(c, x, y + s + 20, x, y + s + 40, { color: bCol, width: 3, alpha: alpha * stripA });
  line(c, x + s * bw, y + s + 20, x + s * bw, y + s + 40, { color: bCol, width: 3, alpha: alpha * stripA });
  dm(c, wLabel, x + s * bw / 2, y + s + 86, { size: 38, color: bCol, alpha: alpha * stripA });
  if (showA > 0) {
    line(c, x - 30, y + s, x - 30, y + s * (1 - ah), { color: aCol, width: 3, alpha: alpha * showA });
    line(c, x - 40, y + s, x - 20, y + s, { color: aCol, width: 3, alpha: alpha * showA });
    line(c, x - 40, y + s * (1 - ah), x - 20, y + s * (1 - ah), { color: aCol, width: 3, alpha: alpha * showA });
    dm(c, hLabel, x - 50, y + s * (1 - ah / 2) + 12, { size: 38, color: aCol, alpha: alpha * showA, align: 'right' });
    if (areaLabel) dm(c, areaLabel, x + s * bw / 2, y + s * (1 - ah / 2) + 14, { size: 42, color: C.white, alpha: alpha * showA });
  }
}

// Binary tree for F(F(x,y),z) (left) or F(x,F(y,z)) (right).
export function assocTree(c, cx, top, left, alpha, prog = 1, cols = [C.yellow, C.green, C.blue]) {
  if (alpha <= 0) return;
  const leafY = top + 230, midY = top + 120, gap = 150;
  const leaves = [[cx - gap, 'x'], [cx, 'y'], [cx + gap, 'z']];
  const mid = left ? [cx - gap / 2, midY] : [cx + gap / 2, midY];
  const root = [cx, top];
  const p1 = clamp(prog * 2), p2 = clamp(prog * 2 - 1);
  const pairs = left ? [[0, mid], [1, mid]] : [[1, mid], [2, mid]];
  for (const [i, m] of pairs) line(c, leaves[i][0], leafY - 30, m[0], m[1] + 26, { color: C.grey, width: 3, alpha: alpha * p1 });
  line(c, mid[0], mid[1] - 26, root[0], root[1] + 26, { color: C.grey, width: 3, alpha: alpha * p2 });
  const other = left ? 2 : 0;
  line(c, leaves[other][0], leafY - 30, root[0], root[1] + 26, { color: C.grey, width: 3, alpha: alpha * p2 });
  leaves.forEach(([lx, s], i) => drawMath(c, s, lx, leafY + 14, { size: 46, color: cols[i], alpha }));
  for (const [P, q] of [[mid, p1], [root, p2]]) {
    if (q <= 0) continue;
    dot(c, P[0], P[1], 26, { color: '#1b1b20', alpha: alpha * q });
    c.save(); c.globalAlpha = alpha * q; c.strokeStyle = C.white; c.lineWidth = 2.5; c.beginPath(); c.arc(P[0], P[1], 26, 0, Math.PI * 2); c.stroke(); c.restore();
    drawMath(c, 'F', P[0], P[1] + 12, { size: 34, alpha: alpha * q });
  }
}

export function bubble(c, s, x, y, alpha, color = C.blue, size = 40) {
  if (alpha <= 0) return;
  const w = [...s].length * size + 70;
  rect(c, x - w / 2, y - size * 1.2, w, size * 2.4, { stroke: color, width: 2.5, alpha, r: size * 1.2, fill: '#141418' });
  drawText(c, s, x, y, { size, alpha });
}

export { arrow, line, dot, rect, lerp, clamp, smooth };
