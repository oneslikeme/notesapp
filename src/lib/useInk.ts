import { useRef } from 'react';
import type React from 'react';
import { getState, setState } from './store';
import type { Stroke } from './types';
import { capturePointer, uid } from './util';
import { cssColor, livePath } from './ink';

export interface InkInputOptions {
  /** Is an ink tool currently active for this surface? */
  active: () => boolean;
  toLocal: (clientX: number, clientY: number) => [number, number];
  /** Multiplier from screen px to local units (e.g. 1/zoom). */
  unit?: () => number;
  onStroke: (s: Stroke) => void;
  onErase: (x: number, y: number, r: number) => void;
  onEraseEnd?: () => void;
  livePath: React.RefObject<SVGPathElement | null>;
  /** Touch that isn't drawing: let the host scroll/pan. */
  onTouchPan?: (dx: number, dy: number) => void;
  onBegin?: () => void;
}

export function touchDraws() {
  const { settings, penSeen } = getState();
  if (settings.fingerDraw === 'on') return true;
  if (settings.fingerDraw === 'off') return false;
  return !penSeen;
}

export function useInkInput(o: InkInputOptions) {
  const opts = useRef(o);
  opts.current = o;
  const st = useRef<{
    mode: 'draw' | 'erase' | 'pan' | null;
    pointerId: number;
    stroke: Stroke | null;
    raf: number;
    lastX: number;
    lastY: number;
  }>({ mode: null, pointerId: -1, stroke: null, raf: 0, lastX: 0, lastY: 0 });

  const render = () => {
    const s = st.current;
    s.raf = 0;
    const el = opts.current.livePath.current;
    if (!el || !s.stroke) return;
    el.setAttribute('d', livePath(s.stroke));
  };

  const addPoints = (e: React.PointerEvent) => {
    const s = st.current;
    if (!s.stroke) return;
    const native = e.nativeEvent as PointerEvent;
    const events = native.getCoalescedEvents?.() ?? [native];
    for (const ev of events.length ? events : [native]) {
      const [x, y] = opts.current.toLocal(ev.clientX, ev.clientY);
      const p = s.stroke.sim ? 0.5 : Math.max(0.05, ev.pressure || 0.5);
      const pts = s.stroke.pts;
      const n = pts.length;
      if (n >= 3 && Math.abs(pts[n - 3] - x) < 0.3 && Math.abs(pts[n - 2] - y) < 0.3) continue;
      pts.push(Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(p * 100) / 100);
    }
    if (!s.raf) s.raf = requestAnimationFrame(render);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const s = st.current;
    if (e.pointerType === 'pen' && !getState().penSeen) setState({ penSeen: true });
    if (s.mode === 'draw' || s.mode === 'erase') {
      // Palm rejection: ignore extra contacts while inking.
      if (e.pointerType === 'touch') return;
    }
    if (!opts.current.active()) return;
    const eraserButton = e.button === 5 || (e.buttons & 32) === 32;
    if (e.pointerType === 'touch' && !touchDraws()) {
      if (opts.current.onTouchPan) {
        s.mode = 'pan';
        s.pointerId = e.pointerId;
        s.lastX = e.clientX;
        s.lastY = e.clientY;
        capturePointer(e.currentTarget as Element, e.pointerId);
        e.preventDefault();
      }
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    capturePointer(e.currentTarget as Element, e.pointerId);
    s.pointerId = e.pointerId;
    opts.current.onBegin?.();
    const { ink } = getState();
    const unit = opts.current.unit?.() ?? 1;
    if (ink.tool === 'eraser' || eraserButton) {
      s.mode = 'erase';
      const [x, y] = opts.current.toLocal(e.clientX, e.clientY);
      opts.current.onErase(x, y, 8 * unit);
      return;
    }
    s.mode = 'draw';
    const hl = ink.tool === 'highlighter';
    const prefs = hl ? ink.hl : ink.pen;
    s.stroke = {
      id: uid(),
      tool: hl ? 'highlighter' : 'pen',
      color: prefs.color,
      size: Math.round(prefs.size * unit * 100) / 100,
      pts: [],
      sim: e.pointerType !== 'pen',
    };
    const el = opts.current.livePath.current;
    if (el) {
      el.style.fill = cssColor(prefs.color);
      el.style.opacity = hl ? '0.45' : '1';
      el.style.mixBlendMode = hl ? 'multiply' : 'normal';
    }
    addPoints(e);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const s = st.current;
    if (e.pointerId !== s.pointerId || !s.mode) return;
    if (s.mode === 'pan') {
      opts.current.onTouchPan?.(e.clientX - s.lastX, e.clientY - s.lastY);
      s.lastX = e.clientX;
      s.lastY = e.clientY;
      return;
    }
    e.preventDefault();
    if (s.mode === 'erase') {
      const native = e.nativeEvent as PointerEvent;
      const unit = opts.current.unit?.() ?? 1;
      const evs = native.getCoalescedEvents?.() ?? [];
      for (const ev of evs.length ? evs : [native]) {
        const [x, y] = opts.current.toLocal(ev.clientX, ev.clientY);
        opts.current.onErase(x, y, 8 * unit);
      }
      return;
    }
    addPoints(e);
  };

  const end = (e: React.PointerEvent, cancel = false) => {
    const s = st.current;
    if (e.pointerId !== s.pointerId) return;
    const mode = s.mode;
    s.mode = null;
    s.pointerId = -1;
    if (s.raf) cancelAnimationFrame(s.raf), (s.raf = 0);
    if (mode === 'erase') opts.current.onEraseEnd?.();
    if (mode === 'draw' && s.stroke) {
      const stroke = s.stroke;
      s.stroke = null;
      if (!cancel && stroke.pts.length) opts.current.onStroke(stroke);
      // Clear live path on the next frame so the committed stroke paints first (no flicker).
      requestAnimationFrame(() => opts.current.livePath.current?.setAttribute('d', ''));
    }
  };

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: (e: React.PointerEvent) => end(e),
    onPointerCancel: (e: React.PointerEvent) => end(e, true),
  };
}
