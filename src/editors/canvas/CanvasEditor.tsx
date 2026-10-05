import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Eraser, Hand, Highlighter, Image as ImageIcon, MousePointer2, PenLine, Redo2, StickyNote, Type, Undo2, FileText, Grid3x3, Rows3, Circle, Maximize2, Minus, Plus, LayoutGrid,
} from 'lucide-react';
import type { CanvasDoc, CanvasImage, CanvasItem, CanvasNoteCard, CanvasStroke, CanvasText, NoteMeta } from '../../lib/types';
import { useInkInput, touchDraws } from '../../lib/useInk';
import { useStore, getState } from '../../lib/store';
import { hitStroke, strokeBBox, strokePath, translateStroke, cssColor } from '../../lib/ink';
import { StrokePaths } from '../../components/StrokePaths';
import { InkControls, setInkTool } from '../../components/InkToolbar';
import { scheduleSave } from '../../lib/saver';
import { capturePointer, clamp, isTypingTarget, pickFiles, uid } from '../../lib/util';
import { blobUrl, putBlob } from '../../lib/blobs';
import { pickNote } from '../../components/pickers';
import { openNote, createNote } from '../../lib/actions';
import { noteIcon, noteTitle } from '../../components/noteTypes';
import { titleIndex } from '../../lib/doc';
import { IconBtn, openMenu } from '../../components/ui';

type Tool = 'select' | 'hand' | 'pen' | 'highlighter' | 'eraser' | 'text' | 'sticky';
const INK_TOOLS = new Set<Tool>(['pen', 'highlighter', 'eraser']);
const STICKY_COLORS = ['yellow', 'pink', 'blue', 'green', 'gray'];

interface Box { x0: number; y0: number; x1: number; y1: number }

export default function CanvasEditor({ meta, doc, active }: { meta: NoteMeta; doc: CanvasDoc; active: boolean }) {
  const [items, setItems] = useState<CanvasItem[]>(doc?.items ?? []);
  const [view, setView] = useState(doc?.view ?? { x: 0, y: 0, zoom: 1 });
  const [bg, setBg] = useState<CanvasDoc['bg']>(doc?.bg ?? 'dots');
  const [tool, setToolState] = useState<Tool>(() => (getState().penSeen ? 'pen' : 'select'));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const inkTool = useStore((s) => s.ink.tool);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const vp = useRef<HTMLDivElement>(null);
  const live = useRef<SVGPathElement>(null);
  const undo = useRef<CanvasItem[][]>([]);
  const redo = useRef<CanvasItem[][]>([]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const viewRef = useRef(view);
  viewRef.current = view;
  const lastThumb = useRef(0);
  const drafts = useRef(new Map<string, string>());
  const thumb = useRef<string | undefined>(meta.thumb);

  const setTool = (t: Tool) => {
    setToolState(t);
    if (t === 'pen' || t === 'highlighter' || t === 'eraser') setInkTool(t);
    if (t !== 'select') setSelected(new Set());
    setEditing(null);
  };
  // Keep in sync if ink tool changes from elsewhere (e.g. InkControls).
  useEffect(() => {
    if (INK_TOOLS.has(tool) && tool !== inkTool) setToolState(inkTool);
  }, [inkTool]);

  /* ---------- persistence ---------- */
  // `edit = false` for view-only changes (pan/zoom/background) so they don't count as edits.
  const edited = useRef(false);
  const save = useCallback((edit = true) => {
    if (edit) edited.current = true;
    scheduleSave(meta.id, () => {
      const quiet = !edited.current;
      edited.current = false;
      if (Date.now() - lastThumb.current > 4000) {
        thumb.current = renderThumb(itemsRef.current);
        lastThumb.current = Date.now();
      }
      // Text being typed lives in drafts until the box loses focus; include it so nothing is lost.
      const items = drafts.current.size
        ? itemsRef.current.map((i) => (i.type === 'text' && drafts.current.has(i.id) ? { ...i, text: drafts.current.get(i.id)! } : i))
        : itemsRef.current;
      return { doc: { items, view: viewRef.current, bg: bgRef.current }, extra: { thumb: thumb.current }, quiet };
    }, 700);
  }, [meta.id]);
  const bgRef = useRef(bg);
  bgRef.current = bg;

  const commit = useCallback((next: CanvasItem[]) => {
    undo.current.push(itemsRef.current);
    if (undo.current.length > 200) undo.current.shift();
    redo.current = [];
    itemsRef.current = next;
    setItems(next);
    save();
  }, [save]);

  const doUndo = () => {
    const prev = undo.current.pop();
    if (!prev) return;
    redo.current.push(itemsRef.current);
    setItems(prev);
    itemsRef.current = prev;
    setSelected(new Set());
    save();
  };
  const doRedo = () => {
    const next = redo.current.pop();
    if (!next) return;
    undo.current.push(itemsRef.current);
    setItems(next);
    itemsRef.current = next;
    save();
  };

  // Save view changes (no history).
  useEffect(() => {
    const t = setTimeout(() => save(false), 800);
    return () => clearTimeout(t);
  }, [view, bg]);

  /* ---------- coordinates ---------- */
  const toWorld = useCallback((cx: number, cy: number): [number, number] => {
    const r = vp.current!.getBoundingClientRect();
    const v = viewRef.current;
    return [(cx - r.left - v.x) / v.zoom, (cy - r.top - v.y) / v.zoom];
  }, []);
  const center = (): [number, number] => {
    const r = vp.current!.getBoundingClientRect();
    return toWorld(r.left + r.width / 2, r.top + r.height / 2);
  };

  const zoomAt = (cx: number, cy: number, factor: number) => {
    const r = vp.current!.getBoundingClientRect();
    setView((v) => {
      const zoom = clamp(v.zoom * factor, 0.1, 6);
      const px = cx - r.left, py = cy - r.top;
      return { zoom, x: px - ((px - v.x) / v.zoom) * zoom, y: py - ((py - v.y) / v.zoom) * zoom };
    });
  };

  /* ---------- ink ---------- */
  const erasing = useRef<CanvasItem[] | null>(null);
  const eraseBase = useRef<CanvasItem[] | null>(null);
  const ink = useInkInput({
    active: () => INK_TOOLS.has(toolRef.current),
    toLocal: toWorld,
    unit: () => 1 / viewRef.current.zoom,
    livePath: live,
    onStroke: (s) => commit([...itemsRef.current, { ...s, type: 'stroke' } as CanvasStroke]),
    onErase: (x, y, r) => {
      const cur = erasing.current ?? itemsRef.current;
      const next = cur.filter((it) => it.type !== 'stroke' || !hitStroke(it, x, y, r));
      if (next.length !== cur.length) {
        if (!erasing.current) eraseBase.current = itemsRef.current;
        erasing.current = next;
        setItems(next);
      }
    },
    onEraseEnd: () => {
      if (erasing.current) {
        const next = erasing.current;
        erasing.current = null;
        // Undo must return to the state before the erase gesture, not the live-erased one.
        itemsRef.current = eraseBase.current ?? itemsRef.current;
        eraseBase.current = null;
        commit(next);
      }
    },
    onTouchPan: (dx, dy) => setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy })),
  });
  const toolRef = useRef(tool);
  toolRef.current = tool;

  /* ---------- pointer handling ---------- */
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; mx: number; my: number } | null>(null);
  const gesture = useRef<
    | null
    | { kind: 'pan'; id: number; lx: number; ly: number }
    | { kind: 'move'; id: number; sx: number; sy: number; base: CanvasItem[]; moved: boolean }
    | { kind: 'marquee'; id: number; sx: number; sy: number; add: boolean }
  >(null);
  const space = useRef(false);

  const hitItemAt = (x: number, y: number): CanvasItem | null => {
    const r = 6 / viewRef.current.zoom;
    const list = itemsRef.current;
    for (let i = list.length - 1; i >= 0; i--) {
      const it = list[i];
      if (it.type === 'stroke' && hitStroke(it, x, y, r)) return it;
    }
    return null;
  };

  const startMoveImpl = useRef<DownFn>(() => {});
  const startMove = useCallback<DownFn>((e, id, add) => startMoveImpl.current(e, id, add), []);
  startMoveImpl.current = (e, id, add) => {
    let sel = selectedRef.current;
    if (!sel.has(id)) {
      sel = add ? new Set([...sel, id]) : new Set([id]);
      setSelected(sel);
    } else if (add) {
      const n = new Set(sel);
      n.delete(id);
      setSelected(n);
      return;
    }
    const [sx, sy] = toWorld(e.clientX, e.clientY);
    gesture.current = { kind: 'move', id: e.pointerId, sx, sy, base: itemsRef.current, moved: false };
    capturePointer(vp.current, e.pointerId);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.current.size === 2) {
        // Two fingers: pinch/pan, cancel anything else (including a stroke the first finger began).
        gesture.current = null;
        for (const pid of touches.current.keys()) ink.onPointerCancel({ pointerId: pid } as React.PointerEvent);
        const [a, b] = [...touches.current.values()];
        pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
        capturePointer(vp.current, e.pointerId);
        return;
      }
    }
    if (editing && !(e.target as HTMLElement).closest('.cv-text.is-editing')) setEditing(null);
    const eraserBtn = (e.buttons & 32) === 32;
    if ((INK_TOOLS.has(tool) || eraserBtn) && e.button !== 1 && !space.current) {
      if (e.pointerType !== 'touch' || touchDraws()) return ink.onPointerDown(e);
    }
    const panning = tool === 'hand' || e.button === 1 || space.current || (e.pointerType === 'touch' && (tool !== 'select' || !touchDraws()));
    if (panning) {
      gesture.current = { kind: 'pan', id: e.pointerId, lx: e.clientX, ly: e.clientY };
      capturePointer(vp.current, e.pointerId);
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    const [x, y] = toWorld(e.clientX, e.clientY);
    if (tool === 'text' || tool === 'sticky') {
      const it: CanvasText = { type: 'text', id: uid(), x, y: y - 12, w: tool === 'sticky' ? 220 : 280, text: '', size: tool === 'sticky' ? 16 : 18, ...(tool === 'sticky' ? { bg: 'yellow' } : {}) };
      commit([...itemsRef.current, it]);
      setSelected(new Set([it.id]));
      setEditing(it.id);
      setToolState('select');
      e.preventDefault();
      return;
    }
    // select tool: strokes are hit-tested here; HTML items handle themselves.
    const hit = hitItemAt(x, y);
    if (hit) return startMove(e, hit.id, e.shiftKey);
    if (!e.shiftKey) setSelected(new Set());
    gesture.current = { kind: 'marquee', id: e.pointerId, sx: x, sy: y, add: e.shiftKey };
    capturePointer(vp.current, e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.current.size >= 2 && pinch.current) {
        const [a, b] = [...touches.current.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const p = pinch.current;
        setView((v) => ({ ...v, x: v.x + mx - p.mx, y: v.y + my - p.my }));
        zoomAt(mx, my, d / p.d);
        pinch.current = { d, mx, my };
        return;
      }
    }
    ink.onPointerMove(e);
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    if (g.kind === 'pan') {
      const dx = e.clientX - g.lx, dy = e.clientY - g.ly;
      g.lx = e.clientX;
      g.ly = e.clientY;
      setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    } else if (g.kind === 'move') {
      const [x, y] = toWorld(e.clientX, e.clientY);
      const dx = x - g.sx, dy = y - g.sy;
      if (!g.moved && Math.hypot(dx, dy) * viewRef.current.zoom < 3) return;
      g.moved = true;
      const sel = selectedRef.current;
      const next = g.base.map((it) => (sel.has(it.id) ? moveItem(it, dx, dy) : it));
      itemsRef.current = next;
      setItems(next);
    } else if (g.kind === 'marquee') {
      const [x, y] = toWorld(e.clientX, e.clientY);
      setMarquee({ x0: Math.min(g.sx, x), y0: Math.min(g.sy, y), x1: Math.max(g.sx, x), y1: Math.max(g.sy, y) });
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    touches.current.delete(e.pointerId);
    if (touches.current.size < 2) pinch.current = null;
    ink.onPointerUp(e);
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    gesture.current = null;
    if (g.kind === 'move' && g.moved) {
      const next = itemsRef.current;
      itemsRef.current = g.base;
      commit(next);
    } else if (g.kind === 'marquee' && marqueeRef.current) {
      const m = marqueeRef.current;
      const ids = new Set(g.add ? selectedRef.current : []);
      for (const it of itemsRef.current) {
        const b = itemBox(it, vp.current!);
        if (b && b.x0 < m.x1 && b.x1 > m.x0 && b.y0 < m.y1 && b.y1 > m.y0) ids.add(it.id);
      }
      setSelected(ids);
      setMarquee(null);
    }
  };
  const marqueeRef = useRef(marquee);
  marqueeRef.current = marquee;

  /* ---------- wheel zoom / pan ---------- */
  useEffect(() => {
    const el = vp.current!;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('.cv-text.is-editing textarea')) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0025) * (e.ctrlKey && !e.metaKey && Math.abs(e.deltaY) < 50 ? 4 : 1)));
      else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  /* ---------- adding things ---------- */
  const addImages = async (files: File[], at?: [number, number]) => {
    let [x, y] = at ?? center();
    const added: CanvasItem[] = [];
    for (const f of files.filter((f) => f.type.startsWith('image/'))) {
      const blobId = await putBlob(f, f.name);
      const url = await blobUrl(blobId);
      const img = new Image();
      img.src = url!;
      await img.decode().catch(() => {});
      const w = Math.min(480, img.naturalWidth || 400);
      const h = img.naturalWidth ? (w * img.naturalHeight) / img.naturalWidth : 300;
      added.push({ type: 'image', id: uid(), x: x - w / 2, y: y - h / 2, w, h, blobId });
      x += 24;
      y += 24;
    }
    if (added.length) {
      // Images sit under ink, so put them first in z-order.
      commit([...added, ...itemsRef.current]);
      setSelected(new Set(added.map((a) => a.id)));
      setToolState('select');
    }
  };

  const addCard = async () => {
    const res = await pickNote({ title: 'Add a note card…', exclude: meta.id, allowCreate: 'page' });
    if (!res) return;
    const n = 'create' in res ? await createNote('page', { title: res.create, open: false }) : res;
    const [x, y] = center();
    const it: CanvasNoteCard = { type: 'card', id: uid(), x: x - 130, y: y - 40, w: 260, noteId: n.id };
    commit([...itemsRef.current, it]);
    setSelected(new Set([it.id]));
    setToolState('select');
  };

  const clipboard = useRef<CanvasItem[]>([]);

  /* ---------- keyboard ---------- */
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTypingTarget(e.target)) {
        space.current = e.type === 'keydown';
        if (vp.current) vp.current.style.cursor = space.current ? 'grab' : '';
        if (!isTypingTarget(e.target)) e.preventDefault();
        return;
      }
      if (e.type !== 'keydown' || isTypingTarget(e.target) || document.querySelector('.modal-backdrop, .menu-backdrop')) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') return e.preventDefault(), e.shiftKey ? doRedo() : doUndo();
      if (mod && k === 'y') return e.preventDefault(), doRedo();
      if (mod && k === 'a') return e.preventDefault(), setTool('select'), setSelected(new Set(itemsRef.current.map((i) => i.id)));
      if (mod && (k === 'c' || k === 'x') && selectedRef.current.size) {
        clipboard.current = itemsRef.current.filter((i) => selectedRef.current.has(i.id));
        if (k === 'x') commit(itemsRef.current.filter((i) => !selectedRef.current.has(i.id)));
        return;
      }
      if (mod && k === 'd' && selectedRef.current.size) {
        e.preventDefault();
        const dup = itemsRef.current.filter((i) => selectedRef.current.has(i.id)).map((i) => ({ ...moveItem(i, 24, 24), id: uid() }));
        commit([...itemsRef.current, ...dup]);
        setSelected(new Set(dup.map((d) => d.id)));
        return;
      }
      if (mod && (k === '=' || k === '+')) return e.preventDefault(), zoomCenter(1.2);
      if (mod && k === '-') return e.preventDefault(), zoomCenter(1 / 1.2);
      if (mod && k === '0') return e.preventDefault(), setView((v) => ({ ...v, zoom: 1 }));
      if (mod || e.altKey) return;
      if ((k === 'delete' || k === 'backspace') && selectedRef.current.size) {
        commit(itemsRef.current.filter((i) => !selectedRef.current.has(i.id)));
        setSelected(new Set());
        return;
      }
      if (k.startsWith('arrow') && selectedRef.current.size) {
        e.preventDefault();
        const d = e.shiftKey ? 20 : 2;
        const dx = k === 'arrowleft' ? -d : k === 'arrowright' ? d : 0;
        const dy = k === 'arrowup' ? -d : k === 'arrowdown' ? d : 0;
        commit(itemsRef.current.map((i) => (selectedRef.current.has(i.id) ? moveItem(i, dx, dy) : i)));
        return;
      }
      if (k === 'escape') return setSelected(new Set()), setTool('select');
      if (k === 'enter' && selectedRef.current.size === 1) {
        const it = itemsRef.current.find((i) => selectedRef.current.has(i.id));
        if (it?.type === 'text') return e.preventDefault(), setEditing(it.id);
      }
      const map: Record<string, Tool> = { v: 'select', h: 'hand', p: 'pen', m: 'highlighter', e: 'eraser', t: 'text', s: 'sticky' };
      if (map[k]) return setTool(map[k]);
      if (k === 'i') return pickFiles('image/*', true).then((f) => addImages(f));
      if (k === 'l') return addCard();
      if (k === '1' && e.shiftKey) return fitAll();
    };
    const onPaste = (e: ClipboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const files = Array.from(e.clipboardData?.files || []);
      if (files.length) return e.preventDefault(), addImages(files);
      const text = e.clipboardData?.getData('text/plain');
      if (text?.trim()) {
        e.preventDefault();
        const [x, y] = center();
        const it: CanvasText = { type: 'text', id: uid(), x: x - 140, y, w: 280, text: text.trim(), size: 18 };
        commit([...itemsRef.current, it]);
        setSelected(new Set([it.id]));
        return;
      }
      if (clipboard.current.length) {
        const dup = clipboard.current.map((i) => ({ ...moveItem(i, 32, 32), id: uid() }));
        clipboard.current = dup;
        commit([...itemsRef.current, ...dup]);
        setSelected(new Set(dup.map((d) => d.id)));
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('paste', onPaste);
    };
  }, [active, tool]);

  const zoomCenter = (f: number) => {
    const r = vp.current!.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, f);
  };

  const fitAll = () => {
    const el = vp.current!;
    let b: Box | null = null;
    for (const it of itemsRef.current) {
      const ib = itemBox(it, el);
      if (!ib) continue;
      b = b ? { x0: Math.min(b.x0, ib.x0), y0: Math.min(b.y0, ib.y0), x1: Math.max(b.x1, ib.x1), y1: Math.max(b.y1, ib.y1) } : ib;
    }
    const r = el.getBoundingClientRect();
    if (!b) return setView({ x: r.width / 2, y: r.height / 3, zoom: 1 });
    const zoom = clamp(Math.min((r.width - 120) / (b.x1 - b.x0 || 1), (r.height - 160) / (b.y1 - b.y0 || 1)), 0.1, 2);
    setView({ zoom, x: r.width / 2 - ((b.x0 + b.x1) / 2) * zoom, y: r.height / 2 - ((b.y0 + b.y1) / 2) * zoom });
  };

  // Start new canvases centred.
  useLayoutEffect(() => {
    if (!doc?.items?.length && view.x === 0 && view.y === 0 && vp.current) {
      const r = vp.current.getBoundingClientRect();
      setView({ x: r.width / 2, y: r.height / 3, zoom: 1 });
    }
  }, []);

  /* ---------- item mutation helpers ---------- */
  const updateItem = useCallback((id: string, patch: Partial<CanvasItem>, history = true) => {
    const next = itemsRef.current.map((i) => (i.id === id ? ({ ...i, ...patch } as CanvasItem) : i));
    if (history) commit(next);
    else {
      itemsRef.current = next;
      setItems(next);
      save();
    }
  }, [commit, save]);

  const strokes = useMemo(() => items.filter((i): i is CanvasStroke => i.type === 'stroke'), [items]);
  const images = useMemo(() => items.filter((i): i is CanvasImage => i.type === 'image'), [items]);
  const others = useMemo(() => items.filter((i): i is CanvasText | CanvasNoteCard => i.type === 'text' || i.type === 'card'), [items]);

  const selBox = useMemo(() => {
    if (!selected.size || !vp.current) return null;
    let b: Box | null = null;
    for (const it of items) {
      if (!selected.has(it.id)) continue;
      const ib = itemBox(it, vp.current);
      if (!ib) continue;
      b = b ? { x0: Math.min(b.x0, ib.x0), y0: Math.min(b.y0, ib.y0), x1: Math.max(b.x1, ib.x1), y1: Math.max(b.y1, ib.y1) } : ib;
    }
    return b;
  }, [selected, items]);

  const isInk = INK_TOOLS.has(tool);
  const gridSize = 24 * view.zoom;
  const selectedOne = selected.size === 1 ? items.find((i) => selected.has(i.id)) : undefined;

  return (
    <div className="canvas-wrap">
      <div
        ref={vp}
        className={`canvas-vp bg-${bg} tool-${tool} ${isInk ? 'is-inking' : ''}`}
        style={{ backgroundSize: `${gridSize}px ${gridSize}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={(e) => (ink.onPointerCancel(e), onPointerUp(e))}
        onDoubleClick={(e) => {
          if (tool !== 'select' || e.target !== vp.current) return;
          const [x, y] = toWorld(e.clientX, e.clientY);
          const it: CanvasText = { type: 'text', id: uid(), x, y: y - 12, w: 280, text: '', size: 18 };
          commit([...itemsRef.current, it]);
          setSelected(new Set([it.id]));
          setEditing(it.id);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const files = Array.from(e.dataTransfer.files);
          if (files.length) addImages(files, toWorld(e.clientX, e.clientY));
        }}
      >
        <div className="canvas-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
          <div className="cv-layer">
            {images.map((it) => (
              <ImageItem key={it.id} it={it} selected={selected.has(it.id)} onDown={startMove} onResize={updateItem} zoom={view.zoom} />
            ))}
          </div>
          <svg className="cv-ink">
            <StrokePaths strokes={strokes} selected={selected} />
            <path ref={live} />
          </svg>
          <div className="cv-layer">
            {others.map((it) =>
              it.type === 'text' ? (
                <TextItem
                  key={it.id}
                  it={it}
                  selected={selected.has(it.id)}
                  editing={editing === it.id}
                  onDown={startMove}
                  onEdit={() => (setSelected(new Set([it.id])), setEditing(it.id))}
                  onDraft={(text) => {
                    drafts.current.set(it.id, text);
                    save();
                  }}
                  onDone={(text) => {
                    drafts.current.delete(it.id);
                    setEditing(null);
                    if (!text.trim()) commit(itemsRef.current.filter((i) => i.id !== it.id));
                    else if (text !== it.text) updateItem(it.id, { text });
                  }}
                  onResize={updateItem}
                />
              ) : (
                <CardItem key={it.id} it={it} selected={selected.has(it.id)} onDown={startMove} />
              ),
            )}
          </div>
          {selBox && (
            <div
              className="cv-selection"
              style={{ left: selBox.x0 - 4 / view.zoom, top: selBox.y0 - 4 / view.zoom, width: selBox.x1 - selBox.x0 + 8 / view.zoom, height: selBox.y1 - selBox.y0 + 8 / view.zoom, borderWidth: 1.5 / view.zoom }}
            />
          )}
          {marquee && <div className="cv-marquee" style={{ left: marquee.x0, top: marquee.y0, width: marquee.x1 - marquee.x0, height: marquee.y1 - marquee.y0, borderWidth: 1 / view.zoom }} />}
        </div>
        {!items.length && (
          <div className="canvas-empty">
            <p>An infinite canvas. Draw with a pen, double-click to type, paste or drop images.</p>
            <p className="muted small">Space-drag or two fingers to pan · Ctrl/⌘ + scroll or pinch to zoom</p>
          </div>
        )}
      </div>

      <div className="canvas-toolbar" onPointerDown={(e) => e.stopPropagation()}>
        <div className="tool-group">
          <IconBtn icon={MousePointer2} label="Select" kbd="V" active={tool === 'select'} onClick={() => setTool('select')} />
          <IconBtn icon={Hand} label="Pan" kbd="H / Space" active={tool === 'hand'} onClick={() => setTool('hand')} />
        </div>
        <div className="tool-group">
          <IconBtn icon={PenLine} label="Pen" kbd="P" active={tool === 'pen'} onClick={() => setTool('pen')} />
          <IconBtn icon={Highlighter} label="Highlighter" kbd="M" active={tool === 'highlighter'} onClick={() => setTool('highlighter')} />
          <IconBtn icon={Eraser} label="Eraser" kbd="E" active={tool === 'eraser'} onClick={() => setTool('eraser')} />
        </div>
        <div className="tool-group">
          <IconBtn icon={Type} label="Text" kbd="T" active={tool === 'text'} onClick={() => setTool('text')} />
          <IconBtn icon={StickyNote} label="Sticky note" kbd="S" active={tool === 'sticky'} onClick={() => setTool('sticky')} />
          <IconBtn icon={ImageIcon} label="Image" kbd="I" onClick={async () => addImages(await pickFiles('image/*', true))} />
          <IconBtn icon={FileText} label="Note card" kbd="L" onClick={addCard} />
        </div>
        {isInk && <InkControls showTools={false} />}
        {selectedOne?.type === 'text' && (
          <div className="tool-group">
            {[14, 18, 24, 36].map((s) => (
              <button key={s} className={`chip ${selectedOne.size === s ? 'is-on' : ''}`} onClick={() => updateItem(selectedOne.id, { size: s })}>
                {s === 14 ? 'S' : s === 18 ? 'M' : s === 24 ? 'L' : 'XL'}
              </button>
            ))}
            {STICKY_COLORS.map((c) => (
              <button key={c} className={`swatch sticky-sw ${selectedOne.bg === c ? 'is-on' : ''}`} data-c={c} title={`${c} sticky`} onClick={() => updateItem(selectedOne.id, { bg: selectedOne.bg === c ? undefined : c })} />
            ))}
          </div>
        )}
        <div className="tool-group">
          <IconBtn icon={Undo2} label="Undo" kbd="Ctrl+Z" onClick={doUndo} />
          <IconBtn icon={Redo2} label="Redo" kbd="Ctrl+Shift+Z" onClick={doRedo} />
        </div>
      </div>

      <div className="canvas-zoom" onPointerDown={(e) => e.stopPropagation()}>
        <IconBtn icon={Minus} label="Zoom out" size={15} onClick={() => zoomCenter(1 / 1.2)} />
        <button className="zoom-label" title="Reset zoom" onClick={() => setView((v) => ({ ...v, zoom: 1 }))}>{Math.round(view.zoom * 100)}%</button>
        <IconBtn icon={Plus} label="Zoom in" size={15} onClick={() => zoomCenter(1.2)} />
        <IconBtn icon={Maximize2} label="Fit everything" kbd="Shift+1" size={15} onClick={fitAll} />
        <IconBtn
          icon={LayoutGrid}
          label="Background"
          size={15}
          onClick={(e) =>
            openMenu(e.currentTarget, [
              { header: 'Background' },
              { label: 'Dots', icon: Circle, checked: bg === 'dots', onClick: () => setBg('dots') },
              { label: 'Grid', icon: Grid3x3, checked: bg === 'grid', onClick: () => setBg('grid') },
              { label: 'Lines', icon: Rows3, checked: bg === 'lines', onClick: () => setBg('lines') },
              { label: 'Plain', checked: bg === 'plain', onClick: () => setBg('plain') },
            ])
          }
        />
      </div>
    </div>
  );
}

/* ---------------- helpers ---------------- */

function moveItem(it: CanvasItem, dx: number, dy: number): CanvasItem {
  if (it.type === 'stroke') return translateStroke(it, dx, dy);
  return { ...it, x: it.x + dx, y: it.y + dy };
}

function itemBox(it: CanvasItem, root: HTMLElement): Box | null {
  if (it.type === 'stroke') return strokeBBox(it);
  if (it.type === 'image') return { x0: it.x, y0: it.y, x1: it.x + it.w, y1: it.y + it.h };
  const el = root.querySelector<HTMLElement>(`[data-id="${it.id}"]`);
  const h = el ? el.offsetHeight : 40;
  return { x0: it.x, y0: it.y, x1: it.x + it.w, y1: it.y + h };
}

function renderThumb(items: CanvasItem[]) {
  const strokes = items.filter((i): i is CanvasStroke => i.type === 'stroke');
  if (!items.length) return undefined;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const it of items) {
    const b = it.type === 'stroke' ? strokeBBox(it) : { x0: it.x, y0: it.y, x1: it.x + it.w, y1: it.y + (it.type === 'image' ? it.h : 60) };
    x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1);
  }
  const W = 320, H = 200;
  const s = Math.min(W / (x1 - x0 + 40), H / (y1 - y0 + 40), 1.2);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.translate(W / 2 - ((x0 + x1) / 2) * s, H / 2 - ((y0 + y1) / 2) * s);
  ctx.scale(s, s);
  for (const it of items) {
    if (it.type === 'text') {
      ctx.fillStyle = it.bg ? '#fff1a8' : '#e9e9e6';
      ctx.fillRect(it.x, it.y, it.w, it.bg ? 80 : Math.max(18, it.size * 1.4));
    } else if (it.type === 'image') {
      ctx.fillStyle = '#dfe4f0';
      ctx.fillRect(it.x, it.y, it.w, it.h);
    } else if (it.type === 'card') {
      ctx.fillStyle = '#eef0f6';
      ctx.fillRect(it.x, it.y, it.w, 64);
    }
  }
  for (const st of strokes) {
    ctx.fillStyle = st.color === 'ink' ? '#222' : cssColor(st.color);
    ctx.globalAlpha = st.tool === 'highlighter' ? 0.45 : 1;
    ctx.fill(new Path2D(strokePath(st)));
  }
  return c.toDataURL('image/jpeg', 0.75);
}

/* ---------------- item components ---------------- */

type DownFn = (e: React.PointerEvent, id: string, add: boolean) => void;

function itemDown(e: React.PointerEvent, it: CanvasItem, onDown: DownFn) {
  const vpEl = (e.currentTarget as HTMLElement).closest('.canvas-vp')!;
  if (vpEl.classList.contains('tool-select') && e.button === 0 && !(e.pointerType === 'touch' && !touchDraws())) {
    e.stopPropagation();
    onDown(e, it.id, e.shiftKey);
  }
}

const ImageItem = memo(function ImageItem({ it, selected, onDown, onResize, zoom }: { it: CanvasImage; selected: boolean; onDown: DownFn; onResize: (id: string, p: Partial<CanvasItem>) => void; zoom: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => void blobUrl(it.blobId).then(setUrl), [it.blobId]);
  const resize = (e: React.PointerEvent) => {
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    capturePointer(el, e.pointerId);
    const sx = e.clientX, w0 = it.w, ratio = it.h / it.w;
    const frame = el.parentElement!;
    let w = w0;
    const move = (ev: PointerEvent) => {
      w = Math.max(40, w0 + (ev.clientX - sx) / zoom);
      frame.style.width = `${w}px`;
      frame.style.height = `${w * ratio}px`;
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      onResize(it.id, { w, h: w * ratio });
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  return (
    <div className={`cv-image ${selected ? 'is-selected' : ''}`} data-id={it.id} style={{ left: it.x, top: it.y, width: it.w, height: it.h }} onPointerDown={(e) => itemDown(e, it, onDown)}>
      {url && <img src={url} alt="" draggable={false} />}
      {selected && <span className="cv-handle br" onPointerDown={resize} />}
    </div>
  );
});

function renderLinks(text: string) {
  if (!text.includes('[[')) return text;
  const parts = text.split(/(\[\[[^\]\n]+\]\])/g);
  const idx = titleIndex();
  return parts.map((p, i) => {
    const m = p.match(/^\[\[(.+)\]\]$/);
    if (!m) return p;
    const id = idx.get(m[1].trim().toLowerCase());
    return (
      <a
        key={i}
        className={`wikilink ${id ? '' : 'is-broken'}`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={async () => openNote(id ?? (await createNote('page', { title: m[1].trim(), open: false })).id)}
      >
        {m[1]}
      </a>
    );
  });
}

const TextItem = memo(function TextItem({
  it, selected, editing, onDown, onEdit, onDraft, onDone, onResize,
}: { it: CanvasText; selected: boolean; editing: boolean; onDown: DownFn; onEdit: () => void; onDraft: (t: string) => void; onDone: (t: string) => void; onResize: (id: string, p: Partial<CanvasItem>) => void }) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const [v, setV] = useState(it.text);
  useEffect(() => setV(it.text), [it.text]);
  useLayoutEffect(() => {
    if (!editing || !ta.current) return;
    ta.current.style.height = '0';
    ta.current.style.height = ta.current.scrollHeight + 'px';
  }, [v, editing]);
  useEffect(() => {
    if (editing) ta.current?.focus();
  }, [editing]);
  const resize = (e: React.PointerEvent) => {
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    capturePointer(el, e.pointerId);
    const frame = el.parentElement!;
    const zoom = frame.getBoundingClientRect().width / frame.offsetWidth;
    const sx = e.clientX, w0 = it.w;
    let w = w0;
    const move = (ev: PointerEvent) => {
      w = Math.max(80, w0 + (ev.clientX - sx) / zoom);
      frame.style.width = `${w}px`;
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      onResize(it.id, { w });
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  return (
    <div
      className={`cv-text ${it.bg ? 'is-sticky' : ''} ${selected ? 'is-selected' : ''} ${editing ? 'is-editing' : ''}`}
      data-id={it.id}
      data-c={it.bg}
      style={{ left: it.x, top: it.y, width: it.w, fontSize: it.size }}
      onPointerDown={(e) => !editing && itemDown(e, it, onDown)}
      onDoubleClick={(e) => (e.stopPropagation(), onEdit())}
    >
      {editing ? (
        <textarea
          ref={ta}
          value={v}
          placeholder="Type…"
          onChange={(e) => (setV(e.target.value), onDraft(e.target.value))}
          onBlur={() => onDone(v)}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
              e.preventDefault();
              (e.target as HTMLTextAreaElement).blur();
            }
          }}
        />
      ) : (
        <div className="cv-text-body">{it.text ? renderLinks(it.text) : <span className="muted">Empty</span>}</div>
      )}
      {selected && !editing && <span className="cv-handle r" onPointerDown={resize} />}
    </div>
  );
});

const CardItem = memo(function CardItem({ it, selected, onDown }: { it: CanvasNoteCard; selected: boolean; onDown: DownFn }) {
  const n = useStore((s) => s.notes[it.noteId]);
  const Icon = n ? noteIcon(n) : FileText;
  return (
    <div className={`cv-card ${selected ? 'is-selected' : ''} ${!n || n.trashedAt ? 'is-broken' : ''}`} data-id={it.id} style={{ left: it.x, top: it.y, width: it.w }} onPointerDown={(e) => itemDown(e, it, onDown)} onDoubleClick={() => n && openNote(n.id)}>
      <div className="cv-card-title">
        <Icon size={15} strokeWidth={1.75} /> {noteTitle(n)}
      </div>
      {n?.excerpt && <div className="cv-card-excerpt">{n.excerpt.slice(0, 110)}</div>}
      <div className="cv-card-hint">Double-click to open</div>
    </div>
  );
});
