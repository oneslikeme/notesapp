import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  Bookmark, Copy, Eraser, FilePlus, Highlighter, MessageSquare, Minus, MousePointer2, NotebookPen, PanelLeft, PenLine, Plus, Redo2, Send, Trash, Type, Undo2, Underline, Strikethrough, ListTree, X, MoveHorizontal,
} from 'lucide-react';
import type { NoteMeta, PdfDoc, PdfHighlight, PdfPageAnn } from '../../lib/types';
import { openPdf, releasePdf, renderThumb } from '../../lib/pdf';
import { PdfPage, EMPTY_ANN, type PdfTool } from './PdfPage';
import { InkControls, setInkTool } from '../../components/InkToolbar';
import { useStore, toast } from '../../lib/store';
import { scheduleSave } from '../../lib/saver';
import { clamp, isTypingTarget, uid } from '../../lib/util';
import { HL_COLORS } from '../../lib/ink';
import { IconBtn, Empty, openMenu } from '../../components/ui';
import { PageEditor } from '../page/PageEditor';
import { useRoute } from '../../lib/router';
import { pickNote } from '../../components/pickers';
import { sendClip } from '../../lib/clips';
import { createNote, updateMeta } from '../../lib/actions';
import { liveEditors } from '../../lib/editors';
import { pdfAnnotationsMarkdown, makeCtx } from '../../lib/export';

const GAP = 16;

interface Popover {
  x: number;
  y: number;
  kind: 'selection' | 'highlight';
  text: string;
  rects?: Record<string, [number, number, number, number][]>;
  key?: string;
  h?: PdfHighlight;
}

export default function PdfEditor({ meta, doc, active }: { meta: NoteMeta; doc: PdfDoc; active: boolean }) {
  const [d, setD] = useState<PdfDoc>(doc);
  const dRef = useRef(d);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState<number>(0);
  const [tool, setToolState] = useState<PdfTool>('select');
  const [thumbs, setThumbs] = useState(false);
  const [side, setSide] = useState<null | 'annotations' | 'notes'>(null);
  const [cur, setCur] = useState(Math.max(0, (doc.lastPage || 1) - 1));
  const [near, setNear] = useState<Set<number>>(new Set([0, 1]));
  const [pop, setPop] = useState<Popover | null>(null);
  const inkTool = useStore((s) => s.ink.tool);
  const scroller = useRef<HTMLDivElement>(null);
  const undo = useRef<Record<string, PdfPageAnn>[]>([]);
  const redo = useRef<Record<string, PdfPageAnn>[]>([]);
  const route = useRoute();

  useEffect(() => {
    let alive = true;
    openPdf(doc.blobId)
      .then((p) => {
        if (!alive) return;
        setPdf(p);
        // Imports done in a background tab may have skipped the cover thumbnail.
        if (!meta.thumb) renderThumb(p, 1, 240).then((thumb) => updateMeta(meta.id, { thumb })).catch(() => {});
      })
      .catch((e) => alive && setError(e?.message || 'Could not open PDF'));
    return () => {
      alive = false;
      releasePdf(doc.blobId);
    };
  }, [doc.blobId]);

  // Text-box drafts (page key -> box id -> text) are merged in so typing is saved before the box loses focus.
  const drafts = useRef(new Map<string, Map<string, string>>());
  // `edit = false` for reading position and zoom, which shouldn't count as edits.
  const edited = useRef(false);
  const save = useCallback(
    (edit = true) => {
      if (edit) edited.current = true;
      scheduleSave(meta.id, () => {
        const quiet = !edited.current;
        edited.current = false;
        let doc = dRef.current;
        if (drafts.current.size) {
          const ann = { ...doc.ann };
          for (const [key, boxes] of drafts.current) {
            const a = ann[key];
            if (a) ann[key] = { ...a, texts: a.texts.map((t) => (boxes.has(t.id) ? { ...t, text: boxes.get(t.id)! } : t)) };
          }
          doc = { ...doc, ann };
        }
        return { doc, quiet };
      }, 700);
    },
    [meta.id],
  );
  const onDraft = useCallback(
    (key: string, id: string, text: string | null) => {
      const m = drafts.current.get(key) ?? new Map<string, string>();
      if (text === null) m.delete(id);
      else m.set(id, text);
      if (m.size) drafts.current.set(key, m);
      else drafts.current.delete(key);
      if (text !== null) save();
    },
    [save],
  );

  const setTool = (t: PdfTool) => {
    setToolState(t);
    if (t === 'pen' || t === 'highlighter' || t === 'eraser') setInkTool(t);
    window.getSelection()?.removeAllRanges();
    setPop(null);
  };
  useEffect(() => {
    if ((tool === 'pen' || tool === 'highlighter' || tool === 'eraser') && tool !== inkTool) setToolState(inkTool);
  }, [inkTool]);

  /* ---------- annotations + history ---------- */
  // Live (non-history) updates during a gesture remember where the gesture started, so undo restores it.
  const gestureBase = useRef<Record<string, PdfPageAnn> | null>(null);
  const onAnn = useCallback((key: string, next: PdfPageAnn, history = true) => {
    const prev = dRef.current;
    if (!history && !gestureBase.current) gestureBase.current = prev.ann;
    if (history) {
      undo.current.push(gestureBase.current ?? prev.ann);
      gestureBase.current = null;
      if (undo.current.length > 200) undo.current.shift();
      redo.current = [];
    }
    const nd = { ...prev, ann: { ...prev.ann, [key]: next } };
    dRef.current = nd;
    setD(nd);
    save();
  }, [save]);

  const doUndo = () => {
    const prev = undo.current.pop();
    if (!prev) return;
    redo.current.push(dRef.current.ann);
    const nd = { ...dRef.current, ann: prev };
    dRef.current = nd;
    setD(nd);
    save();
  };
  const doRedo = () => {
    const next = redo.current.pop();
    if (!next) return;
    undo.current.push(dRef.current.ann);
    const nd = { ...dRef.current, ann: next };
    dRef.current = nd;
    setD(nd);
    save();
  };

  const patchDoc = (patch: Partial<PdfDoc>, edit = true) => {
    const nd = { ...dRef.current, ...patch };
    dRef.current = nd;
    setD(nd);
    save(edit);
  };

  /* ---------- layout / zoom ---------- */
  const maxW = useMemo(() => Math.max(...d.pages.map((p) => p.w), 100), [d.pages]);
  const fitWidth = useCallback(() => {
    const el = scroller.current;
    if (!el) return 1;
    return clamp((el.clientWidth - 48) / maxW, 0.3, 2.2);
  }, [maxW]);

  useLayoutEffect(() => {
    if (scale) return;
    setScale(doc.zoom && doc.zoom !== 1 ? doc.zoom : fitWidth());
  }, [scale, fitWidth]);

  const offsets = useMemo(() => {
    const out: number[] = [];
    let y = GAP;
    for (const p of d.pages) {
      out.push(y);
      y += p.h * scale + GAP;
    }
    out.push(y);
    return out;
  }, [d.pages, scale]);

  const prevScale = useRef(scale);
  const firstScale = useRef(0);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && prevScale.current && scale && prevScale.current !== scale) {
      const ratio = scale / prevScale.current;
      el.scrollTop = el.scrollTop * ratio;
      el.scrollLeft = el.scrollLeft * ratio;
    }
    prevScale.current = scale;
    if (scale) {
      // Opening a PDF (computing fit-width) is not an edit.
      if (!firstScale.current) firstScale.current = scale;
      if (scale === firstScale.current || Math.abs(scale - (dRef.current.zoom || 0)) < 0.001) return;
      const t = setTimeout(() => patchDoc({ zoom: scale }, false), 600);
      return () => clearTimeout(t);
    }
  }, [scale]);

  const zoomBy = (f: number) => setScale((s) => clamp(Math.round(s * f * 100) / 100, 0.25, 5));

  const goTo = useCallback((i: number, smooth = false) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ top: offsets[clamp(i, 0, d.pages.length - 1)] - 8, behavior: smooth ? 'smooth' : 'auto' });
  }, [offsets, d.pages.length]);

  // Restore position / honour ?page= links.
  const restored = useRef(false);
  const positioned = useRef(false);
  useEffect(() => {
    if (!scale || restored.current) return;
    restored.current = true;
    const qp = route.name === 'note' && route.id === meta.id ? Number(route.query.get('page')) : 0;
    requestAnimationFrame(() => {
      goTo(qp ? pageIndexFor(qp) : cur);
      positioned.current = true;
    });
  }, [scale]);
  const pageIndexFor = (src: number) => Math.max(0, dRef.current.pages.findIndex((p) => p.src === src));
  useEffect(() => {
    if (!restored.current || route.name !== 'note' || route.id !== meta.id) return;
    const qp = Number(route.query.get('page'));
    if (qp) goTo(pageIndexFor(qp), true);
  }, [route]);

  // Track visible pages + current page.
  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const top = el.scrollTop, bottom = top + el.clientHeight;
    const mid = top + el.clientHeight * 0.35;
    let c = 0;
    const set = new Set<number>();
    for (let i = 0; i < d.pages.length; i++) {
      const a = offsets[i], b = offsets[i + 1];
      if (b > top - 1500 && a < bottom + 1500) set.add(i);
      if (a <= mid) c = i;
    }
    setNear((prev) => (prev.size === set.size && [...set].every((x) => prev.has(x)) ? prev : set));
    setCur(c);
    if (positioned.current && dRef.current.lastPage !== c + 1) {
      dRef.current = { ...dRef.current, lastPage: c + 1 };
      save(false);
    }
  }, [offsets, d.pages.length, save]);
  useEffect(onScroll, [onScroll]);

  /* ---------- text selection → highlight popover ---------- */
  const onPointerUp = () => {
    if (tool !== 'select') return;
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      if (!scroller.current?.contains(range.commonAncestorContainer)) return;
      const text = sel.toString().replace(/\s+\n/g, '\n').trim();
      if (!text) return;
      const rects: Record<string, [number, number, number, number][]> = {};
      const pages = Array.from(scroller.current.querySelectorAll<HTMLElement>('.pdf-page'));
      // Measure only text inside text layers; element boxes (whole pages, ink layers) would swallow the real line rects.
      const lineRects: DOMRect[] = [];
      const walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT);
      for (let n = walker.currentNode as Node | null; n; n = walker.nextNode()) {
        if (n.nodeType !== Node.TEXT_NODE || !range.intersectsNode(n) || !n.parentElement?.closest('.textLayer')) continue;
        const sub = document.createRange();
        sub.selectNodeContents(n);
        if (n === range.startContainer) sub.setStart(n, range.startOffset);
        if (n === range.endContainer) sub.setEnd(n, range.endOffset);
        lineRects.push(...Array.from(sub.getClientRects()));
      }
      for (const r of lineRects) {
        if (r.width < 1 || r.height < 1) continue;
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const pageEl = pages.find((p) => {
          const b = p.getBoundingClientRect();
          return cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom;
        });
        if (!pageEl) continue;
        const b = pageEl.getBoundingClientRect();
        const key = pageEl.dataset.key!;
        (rects[key] ||= []).push([(r.left - b.left) / scale, (r.top - b.top) / scale, r.width / scale, r.height / scale]);
      }
      for (const k of Object.keys(rects)) rects[k] = mergeRects(rects[k]);
      if (!Object.keys(rects).length) return;
      const last = range.getBoundingClientRect();
      setPop({ kind: 'selection', x: last.left + last.width / 2, y: last.top, text, rects });
    }, 10);
  };

  const addHighlight = (kind: PdfHighlight['kind'], color: string) => {
    if (!pop?.rects) return;
    const before = dRef.current.ann;
    let ann = { ...before };
    for (const [key, rects] of Object.entries(pop.rects)) {
      const a = ann[key] ?? EMPTY_ANN;
      ann = { ...ann, [key]: { ...a, highlights: [...a.highlights, { id: uid(), kind, color, rects, text: pop.text, createdAt: Date.now() }] } };
    }
    undo.current.push(before);
    redo.current = [];
    patchDoc({ ann });
    window.getSelection()?.removeAllRanges();
    setPop(null);
  };

  const updateHighlight = (key: string, id: string, patch: Partial<PdfHighlight> | null) => {
    const a = dRef.current.ann[key] ?? EMPTY_ANN;
    const highlights = patch === null ? a.highlights.filter((h) => h.id !== id) : a.highlights.map((h) => (h.id === id ? { ...h, ...patch } : h));
    onAnn(key, { ...a, highlights });
  };

  const pageNumberOf = (key: string) => {
    const p = dRef.current.pages.find((x) => x.key === key);
    return p?.src ?? undefined;
  };

  const sendQuote = async (text: string, key?: string) => {
    setPop(null);
    const res = await pickNote({ title: 'Send quote to…', types: ['research', 'page'], allowCreate: 'research', exclude: meta.id });
    if (!res) return;
    const target = 'create' in res ? await createNote('research', { title: res.create, open: false }) : res;
    await sendClip(target.id, { kind: 'quote', text, source: meta.title || 'PDF', noteId: meta.id, page: key ? pageNumberOf(key) : cur + 1 });
    window.getSelection()?.removeAllRanges();
  };

  const onHighlightClick = useCallback((key: string, h: PdfHighlight, at: { x: number; y: number }) => {
    setPop({ kind: 'highlight', x: at.x, y: at.y - 10, text: h.text, key, h });
  }, []);

  const onTouchPan = useCallback((dx: number, dy: number) => scroller.current?.scrollBy(-dx, -dy), []);

  /* ---------- pages ---------- */
  const insertBlank = (after: number) => {
    const ref = dRef.current.pages[after] ?? dRef.current.pages[0];
    const pages = [...dRef.current.pages];
    pages.splice(after + 1, 0, { key: 'b' + uid(), src: null, w: ref.w, h: ref.h });
    patchDoc({ pages });
    toast('Blank page inserted');
  };
  const removeBlank = (i: number) => {
    const p = dRef.current.pages[i];
    if (p.src) return;
    const ann = { ...dRef.current.ann };
    delete ann[p.key];
    patchDoc({ pages: dRef.current.pages.filter((_, j) => j !== i), ann });
  };
  const toggleBookmark = (i: number) => {
    const key = dRef.current.pages[i].key;
    const b = dRef.current.bookmarks || [];
    patchDoc({ bookmarks: b.includes(key) ? b.filter((x) => x !== key) : [...b, key] });
  };

  /* ---------- keyboard + wheel ---------- */
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || document.querySelector('.modal-backdrop, .menu-backdrop')) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') return e.preventDefault(), e.shiftKey ? doRedo() : doUndo();
      if (mod && k === 'y') return e.preventDefault(), doRedo();
      if (mod && (k === '=' || k === '+')) return e.preventDefault(), zoomBy(1.15);
      if (mod && k === '-') return e.preventDefault(), zoomBy(1 / 1.15);
      if (mod && k === '0') return e.preventDefault(), setScale(fitWidth());
      if (mod || e.altKey) return;
      const map: Record<string, PdfTool> = { v: 'select', p: 'pen', m: 'highlighter', e: 'eraser', t: 'text' };
      if (map[k]) return setTool(map[k]);
      if (k === 'escape') return setPop(null), setTool('select');
      if (k === 'b') return toggleBookmark(cur);
      if (k === 'pagedown' || (k === 'arrowright' && !e.shiftKey) || k === 'j') return e.preventDefault(), goTo(cur + 1);
      if (k === 'pageup' || (k === 'arrowleft' && !e.shiftKey) || k === 'k') return e.preventDefault(), goTo(cur - 1);
      if (k === 'home') return e.preventDefault(), goTo(0);
      if (k === 'end') return e.preventDefault(), goTo(d.pages.length - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, cur, goTo, fitWidth]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      setScale((s) => clamp(s * Math.exp(-e.deltaY * 0.006), 0.25, 5));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    // Pinch-to-zoom with two fingers.
    const touches = new Map<number, { x: number; y: number }>();
    let base = 0;
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) {
        const [a, b] = [...touches.values()];
        base = Math.hypot(a.x - b.x, a.y - b.y);
      }
    };
    const move = (e: PointerEvent) => {
      if (!touches.has(e.pointerId)) return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2 && base) {
        const [a, b] = [...touches.values()];
        const dd = Math.hypot(a.x - b.x, a.y - b.y);
        if (Math.abs(dd - base) > 12) {
          setScale((s) => clamp(s * (dd / base), 0.25, 5));
          base = dd;
        }
      }
    };
    const up = (e: PointerEvent) => {
      touches.delete(e.pointerId);
      if (touches.size < 2) base = 0;
    };
    el.addEventListener('pointerdown', down, true);
    el.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', down, true);
      el.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
    };
  }, [pdf]);

  const totalAnn = useMemo(() => Object.values(d.ann).reduce((a, p) => a + p.highlights.length + p.texts.length + (p.strokes.length ? 1 : 0), 0), [d.ann]);

  if (error) return <Empty icon={X} title="Couldn't open this PDF">{error}</Empty>;
  const pageLabel = d.pages[cur]?.src ? `${d.pages[cur].src}` : `${cur + 1}*`;
  const realCount = d.pages.filter((p) => p.src).length;

  return (
    <div className="pdf-wrap">
      <div className="pdf-toolbar">
        <div className="tool-group">
          <IconBtn icon={PanelLeft} label="Pages" active={thumbs} onClick={() => setThumbs((v) => !v)} />
        </div>
        <div className="tool-group">
          <IconBtn icon={MousePointer2} label="Select & highlight text" kbd="V" active={tool === 'select'} onClick={() => setTool('select')} />
          <IconBtn icon={PenLine} label="Pen" kbd="P" active={tool === 'pen'} onClick={() => setTool('pen')} />
          <IconBtn icon={Highlighter} label="Highlighter" kbd="M" active={tool === 'highlighter'} onClick={() => setTool('highlighter')} />
          <IconBtn icon={Eraser} label="Eraser" kbd="E" active={tool === 'eraser'} onClick={() => setTool('eraser')} />
          <IconBtn icon={Type} label="Text box" kbd="T" active={tool === 'text'} onClick={() => setTool('text')} />
        </div>
        {(tool === 'pen' || tool === 'highlighter') && <InkControls showTools={false} />}
        <div className="tool-group">
          <IconBtn icon={Undo2} label="Undo" kbd="Ctrl+Z" onClick={doUndo} />
          <IconBtn icon={Redo2} label="Redo" kbd="Ctrl+Shift+Z" onClick={doRedo} />
        </div>
        <span className="spacer" />
        <div className="tool-group pdf-pager">
          <input
            className="page-input"
            key={cur}
            defaultValue={pageLabel}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              const n = parseInt((e.target as HTMLInputElement).value);
              if (n) goTo(pageIndexFor(n));
              (e.target as HTMLInputElement).blur();
            }}
            aria-label="Page number"
          />
          <span className="muted small">/ {realCount}</span>
          <IconBtn icon={Bookmark} label="Bookmark page" kbd="B" active={(d.bookmarks || []).includes(d.pages[cur]?.key)} onClick={() => toggleBookmark(cur)} />
          <IconBtn icon={FilePlus} label="Insert blank page after this one" onClick={() => insertBlank(cur)} />
        </div>
        <div className="tool-group">
          <IconBtn icon={Minus} label="Zoom out" kbd="Ctrl -" onClick={() => zoomBy(1 / 1.15)} />
          <button className="zoom-label" title="Fit width" onClick={() => setScale(fitWidth())}>{Math.round(scale * 100)}%</button>
          <IconBtn icon={Plus} label="Zoom in" kbd="Ctrl +" onClick={() => zoomBy(1.15)} />
          <IconBtn icon={MoveHorizontal} label="Fit width" kbd="Ctrl 0" onClick={() => setScale(fitWidth())} />
        </div>
        <div className="tool-group">
          <IconBtn icon={ListTree} label={`Annotations (${totalAnn})`} active={side === 'annotations'} onClick={() => setSide((s) => (s === 'annotations' ? null : 'annotations'))} />
          <IconBtn icon={NotebookPen} label="Notes beside the PDF" active={side === 'notes'} onClick={() => setSide((s) => (s === 'notes' ? null : 'notes'))} />
        </div>
      </div>

      <div className="pdf-body">
        {thumbs && pdf && (
          <Thumbs
            pdf={pdf}
            d={d}
            cur={cur}
            onGo={(i) => goTo(i)}
            onMenu={(i, el) =>
              openMenu(el, [
                { label: 'Insert blank page after', icon: FilePlus, onClick: () => insertBlank(i) },
                { label: (d.bookmarks || []).includes(d.pages[i].key) ? 'Remove bookmark' : 'Bookmark', icon: Bookmark, onClick: () => toggleBookmark(i) },
                ...(d.pages[i].src ? [] : [{ label: 'Delete inserted page', icon: Trash, danger: true, onClick: () => removeBlank(i) }]),
              ])
            }
          />
        )}
        <div ref={scroller} className={`pdf-scroll tool-${tool}`} onScroll={onScroll} onPointerUp={onPointerUp} onPointerDown={() => pop && setPop(null)}>
          <div className="pdf-pages" style={{ height: offsets[offsets.length - 1], minWidth: maxW * scale + 48 }}>
            {scale > 0 &&
              d.pages.map((p, i) => (
                <div key={p.key} className="pdf-page-slot" style={{ top: offsets[i] }}>
                  <PdfPage
                    pdf={pdf}
                    page={p}
                    index={i}
                    scale={scale}
                    ann={d.ann[p.key] ?? EMPTY_ANN}
                    tool={tool}
                    near={near.has(i)}
                    onAnn={onAnn}
                    onHighlightClick={onHighlightClick}
                    onTouchPan={onTouchPan}
                    onDraft={onDraft}
                    bookmarked={(d.bookmarks || []).includes(p.key)}
                  />
                </div>
              ))}
          </div>
        </div>
        {side === 'annotations' && <AnnotationList meta={meta} d={d} onGo={goTo} onClose={() => setSide(null)} onUpdate={updateHighlight} />}
        {side === 'notes' && (
          <aside className="pdf-side">
            <div className="panel-head">
              <strong>Notes</strong>
              <IconBtn icon={X} label="Close" onClick={() => setSide(null)} />
            </div>
            <div className="pdf-notes">
              <PageEditor
                noteId={meta.id}
                initial={dRef.current.notes ?? { type: 'doc', content: [{ type: 'paragraph' }] }}
                placeholder="Notes on this document — type / for blocks, [[ to link"
                onReady={(e) => liveEditors.set(meta.id, e)}
                onDirty={(get) => {
                  dRef.current = { ...dRef.current, notes: get() };
                  save();
                }}
              />
            </div>
          </aside>
        )}
      </div>

      {pop && (
        <div className="pdf-pop" style={{ left: pop.x, top: pop.y }} onPointerDown={(e) => e.stopPropagation()}>
          {pop.kind === 'selection' ? (
            <>
              {Object.entries(HL_COLORS).slice(0, 4).map(([k, v]) => (
                <button key={k} className="swatch" style={{ ['--sw' as any]: v }} title={`Highlight ${k}`} onClick={() => addHighlight('highlight', k)} />
              ))}
              <span className="bubble-sep" />
              <IconBtn icon={Underline} label="Underline" size={16} onClick={() => addHighlight('underline', 'red')} />
              <IconBtn icon={Strikethrough} label="Strike through" size={16} onClick={() => addHighlight('strike', 'red')} />
              <IconBtn icon={Copy} label="Copy text" size={16} onClick={() => (navigator.clipboard.writeText(pop.text), setPop(null), toast('Copied'))} />
              <IconBtn icon={Send} label="Send quote to a note…" size={16} onClick={() => sendQuote(pop.text, Object.keys(pop.rects || {})[0])} />
            </>
          ) : (
            <HighlightPop pop={pop} onUpdate={(p) => (updateHighlight(pop.key!, pop.h!.id, p), p === null || p.color ? setPop(null) : setPop({ ...pop, h: { ...pop.h!, ...p } }))} onSend={() => sendQuote(pop.text, pop.key)} />
          )}
        </div>
      )}
    </div>
  );
}

function HighlightPop({ pop, onUpdate, onSend }: { pop: Popover; onUpdate: (p: Partial<PdfHighlight> | null) => void; onSend: () => void }) {
  const [commenting, setCommenting] = useState(!!pop.h?.comment);
  const [c, setC] = useState(pop.h?.comment ?? '');
  return (
    <div className="hl-pop">
      <div className="row">
        {Object.entries(HL_COLORS).slice(0, 4).map(([k, v]) => (
          <button key={k} className={`swatch ${pop.h?.color === k ? 'is-on' : ''}`} style={{ ['--sw' as any]: v }} title={k} onClick={() => onUpdate({ color: k })} />
        ))}
        <span className="bubble-sep" />
        <IconBtn icon={MessageSquare} label="Comment" size={16} active={commenting} onClick={() => setCommenting((v) => !v)} />
        <IconBtn icon={Copy} label="Copy text" size={16} onClick={() => (navigator.clipboard.writeText(pop.text), toast('Copied'))} />
        <IconBtn icon={Send} label="Send quote to a note…" size={16} onClick={onSend} />
        <IconBtn icon={Trash} label="Remove highlight" size={16} onClick={() => onUpdate(null)} />
      </div>
      {commenting && (
        <textarea
          autoFocus
          className="hl-comment"
          placeholder="Add a comment…"
          value={c}
          onChange={(e) => setC(e.target.value)}
          onBlur={() => c !== (pop.h?.comment ?? '') && onUpdate({ comment: c })}
          onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && (e.target as HTMLElement).blur()}
        />
      )}
    </div>
  );
}

function mergeRects(rects: [number, number, number, number][]) {
  const sorted = [...rects].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const out: [number, number, number, number][] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[1] - r[1]) < r[3] * 0.5 && Math.abs(last[3] - r[3]) < r[3] * 0.6 && r[0] <= last[0] + last[2] + 4) {
      const x0 = Math.min(last[0], r[0]);
      const x1 = Math.max(last[0] + last[2], r[0] + r[2]);
      const y0 = Math.min(last[1], r[1]);
      const y1 = Math.max(last[1] + last[3], r[1] + r[3]);
      out[out.length - 1] = [x0, y0, x1 - x0, y1 - y0];
    } else if (!out.some((o) => o[0] <= r[0] && o[1] <= r[1] && o[0] + o[2] >= r[0] + r[2] && o[1] + o[3] >= r[1] + r[3])) out.push(r);
  }
  return out;
}

/* ---------------- thumbnails ---------------- */

function Thumbs({ pdf, d, cur, onGo, onMenu }: { pdf: PDFDocumentProxy; d: PdfDoc; cur: number; onGo: (i: number) => void; onMenu: (i: number, el: HTMLElement) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector('.is-cur')?.scrollIntoView({ block: 'nearest' });
  }, [cur]);
  return (
    <div ref={ref} className="pdf-thumbs">
      {d.pages.map((p, i) => (
        <button
          key={p.key}
          className={`thumb ${i === cur ? 'is-cur' : ''}`}
          onClick={() => onGo(i)}
          onContextMenu={(e) => (e.preventDefault(), onMenu(i, e.currentTarget))}
        >
          <Thumb pdf={pdf} src={p.src} ratio={p.h / p.w} />
          <span className="thumb-label">
            {(d.bookmarks || []).includes(p.key) && <Bookmark size={11} fill="currentColor" />} {p.src ?? '+'}
            {d.ann[p.key] && (d.ann[p.key].highlights.length || d.ann[p.key].strokes.length || d.ann[p.key].texts.length) ? <span className="thumb-dot" /> : null}
          </span>
        </button>
      ))}
    </div>
  );
}

function Thumb({ pdf, src, ratio }: { pdf: PDFDocumentProxy; src: number | null; ratio: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!src || !ref.current) return;
    const el = ref.current;
    let task: any;
    const io = new IntersectionObserver(async ([en]) => {
      if (!en.isIntersecting) return;
      io.disconnect();
      const page = await pdf.getPage(src);
      const vp1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: 220 / vp1.width });
      el.width = vp.width;
      el.height = vp.height;
      task = page.render({ canvas: el, viewport: vp });
      task.promise.catch(() => {});
    });
    io.observe(el);
    return () => {
      io.disconnect();
      task?.cancel();
    };
  }, [pdf, src]);
  return <canvas ref={ref} className="thumb-canvas" style={{ aspectRatio: `${1 / ratio}` }} />;
}

/* ---------------- annotations list ---------------- */

function AnnotationList({ meta, d, onGo, onClose, onUpdate }: { meta: NoteMeta; d: PdfDoc; onGo: (i: number) => void; onClose: () => void; onUpdate: (key: string, id: string, p: Partial<PdfHighlight> | null) => void }) {
  const rows = d.pages
    .map((p, i) => ({ p, i, a: d.ann[p.key] }))
    .filter((r) => r.a && (r.a.highlights.length || r.a.texts.length || r.a.strokes.length || (d.bookmarks || []).includes(r.p.key)));
  return (
    <aside className="pdf-side">
      <div className="panel-head">
        <strong>Annotations</strong>
        <span className="spacer" />
        <IconBtn
          icon={Copy}
          label="Copy all as Markdown"
          onClick={async () => {
            navigator.clipboard.writeText(`# ${meta.title}\n\n` + pdfAnnotationsMarkdown(d, await makeCtx('embed', null)));
            toast('Copied annotations as Markdown');
          }}
        />
        <IconBtn icon={X} label="Close" onClick={onClose} />
      </div>
      <div className="ann-list">
        {!rows.length && <p className="muted small pad">Select text to highlight it, or pick the pen to write on pages. Everything you add shows up here.</p>}
        {rows.map(({ p, i, a }) => (
          <div key={p.key} className="ann-page">
            <button className="ann-page-head" onClick={() => onGo(i)}>
              Page {p.src ?? `${i + 1} (inserted)`} {(d.bookmarks || []).includes(p.key) && <Bookmark size={12} fill="currentColor" />}
            </button>
            {a!.highlights.map((h) => (
              <div key={h.id} className="ann-item" style={{ ['--hl' as any]: HL_COLORS[h.color] || '#e03e3e' }} onClick={() => onGo(i)}>
                <div className={`ann-text kind-${h.kind}`}>{h.text}</div>
                {h.comment && <div className="ann-comment">{h.comment}</div>}
                <button className="ann-x" title="Remove" onClick={(e) => (e.stopPropagation(), onUpdate(p.key, h.id, null))}>
                  <X size={12} />
                </button>
              </div>
            ))}
            {a!.texts.filter((t) => t.text.trim()).map((t) => (
              <div key={t.id} className="ann-item is-text" onClick={() => onGo(i)}>
                <Type size={12} /> {t.text}
              </div>
            ))}
            {a!.strokes.length > 0 && <div className="ann-item is-ink" onClick={() => onGo(i)}><PenLine size={12} /> {a!.strokes.length} ink stroke{a!.strokes.length > 1 ? 's' : ''}</div>}
          </div>
        ))}
      </div>
    </aside>
  );
}

