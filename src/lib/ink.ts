import { getStroke } from 'perfect-freehand';
import type { Stroke } from './types';

export const PEN_COLORS: Record<string, string> = {
  ink: 'var(--ink)',
  blue: '#2f6fe0',
  red: '#e03e3e',
  green: '#2f9a5c',
  orange: '#e07a10',
  purple: '#8250df',
};
export const HL_COLORS: Record<string, string> = {
  yellow: '#ffd43b',
  green: '#8ce99a',
  pink: '#faa2c1',
  blue: '#91d0ff',
  orange: '#ffc078',
};
export const PEN_SIZES = [1.5, 3, 5, 9];
export const HL_SIZES = [10, 16, 26];

/** Resolve a colour token to a concrete colour (for export / paper backgrounds). */
export function solidColor(token: string, paper = true) {
  if (token === 'ink') return paper ? '#1d1d1f' : '#1d1d1f';
  return PEN_COLORS[token] || HL_COLORS[token] || token;
}

export function cssColor(token: string) {
  return PEN_COLORS[token] || HL_COLORS[token] || token;
}

function options(s: Stroke, last = true) {
  if (s.tool === 'highlighter') {
    return { size: s.size, thinning: 0, smoothing: 0.6, streamline: 0.5, simulatePressure: false, last, start: { cap: false }, end: { cap: false } };
  }
  return { size: s.size, thinning: s.sim ? 0.55 : 0.62, smoothing: 0.55, streamline: 0.4, simulatePressure: !!s.sim, last };
}

export function strokePoints(s: Stroke): number[][] {
  const out: number[][] = [];
  const p = s.pts;
  for (let i = 0; i < p.length; i += 3) out.push([p[i], p[i + 1], p[i + 2]]);
  return out;
}

export function outlinePoints(s: Stroke, last = true) {
  return getStroke(strokePoints(s), options(s, last));
}

export function polygonToPath(poly: number[][]) {
  if (!poly.length) return '';
  const d: string[] = [];
  // Quadratic smoothing through midpoints.
  const [x0, y0] = poly[0];
  d.push(`M${x0.toFixed(2)} ${y0.toFixed(2)}`);
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    d.push(`Q${x1.toFixed(2)} ${y1.toFixed(2)} ${((x1 + x2) / 2).toFixed(2)} ${((y1 + y2) / 2).toFixed(2)}`);
  }
  d.push('Z');
  return d.join('');
}

const pathCache = new WeakMap<Stroke, string>();
export function strokePath(s: Stroke) {
  let d = pathCache.get(s);
  if (d === undefined) {
    d = s.pts.length === 3 ? dotPath(s) : polygonToPath(outlinePoints(s));
    pathCache.set(s, d);
  }
  return d;
}

function dotPath(s: Stroke) {
  const r = (s.size * (s.sim ? 0.5 : 0.35 + (s.pts[2] || 0.5) * 0.5)) / 2 + 0.3;
  const [x, y] = s.pts;
  return `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
}

export function livePath(s: Stroke) {
  return s.pts.length <= 3 ? dotPath(s) : polygonToPath(outlinePoints(s, false));
}

export interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
const bboxCache = new WeakMap<Stroke, BBox>();
export function strokeBBox(s: Stroke): BBox {
  let b = bboxCache.get(s);
  if (b) return b;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < s.pts.length; i += 3) {
    const x = s.pts[i], y = s.pts[i + 1];
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  const pad = s.size / 2;
  b = { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
  bboxCache.set(s, b);
  return b;
}

function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy;
  let t = len ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx - px, cy = ay + t * dy - py;
  return cx * cx + cy * cy;
}

/** Does a circle at (x,y) with radius r touch the stroke? */
export function hitStroke(s: Stroke, x: number, y: number, r: number) {
  const b = strokeBBox(s);
  if (x < b.x0 - r || x > b.x1 + r || y < b.y0 - r || y > b.y1 + r) return false;
  const rr = (r + s.size / 2) ** 2;
  const p = s.pts;
  if (p.length === 3) return (p[0] - x) ** 2 + (p[1] - y) ** 2 <= rr;
  for (let i = 0; i + 5 < p.length; i += 3) {
    if (segDist2(x, y, p[i], p[i + 1], p[i + 3], p[i + 4]) <= rr) return true;
  }
  return false;
}

export function translateStroke<T extends Stroke>(s: T, dx: number, dy: number): T {
  const pts = s.pts.slice();
  for (let i = 0; i < pts.length; i += 3) {
    pts[i] = Math.round((pts[i] + dx) * 10) / 10;
    pts[i + 1] = Math.round((pts[i + 1] + dy) * 10) / 10;
  }
  return { ...s, pts };
}

export function strokeSvg(s: Stroke, paper = true) {
  const fill = paper ? solidColor(s.color) : cssColor(s.color);
  return s.tool === 'highlighter'
    ? `<path d="${strokePath(s)}" fill="${fill}" fill-opacity="0.45" style="mix-blend-mode:multiply"/>`
    : `<path d="${strokePath(s)}" fill="${fill}"/>`;
}
