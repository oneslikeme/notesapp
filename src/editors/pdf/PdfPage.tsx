import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { X } from 'lucide-react';
import { pdfjs } from '../../lib/pdf';
import type { PdfHighlight, PdfPageAnn, PdfPageRef, PdfTextBox, Stroke } from '../../lib/types';
import { StrokePaths } from '../../components/StrokePaths';
import { useInkInput } from '../../lib/useInk';
import { hitStroke, solidColor } from '../../lib/ink';
import { uid } from '../../lib/util';

export type PdfTool = 'select' | 'pen' | 'highlighter' | 'eraser' | 'text';
export const EMPTY_ANN: PdfPageAnn = { strokes: [], highlights: [], texts: [] };
const MAX_PIXELS = 14_000_000;

export interface PageProps {
  pdf: PDFDocumentProxy | null;
  page: PdfPageRef;
  index: number;
  scale: number;
  ann: PdfPageAnn;
  tool: PdfTool;
  near: boolean;
  onAnn: (key: string, next: PdfPageAnn, history?: boolean) => void;
  onHighlightClick: (key: string, h: PdfHighlight, at: { x: number; y: number }) => void;
  onTouchPan: (dx: number, dy: number) => void;
  bookmarked: boolean;
  onDraft: (key: string, id: string, text: string | null) => void;
}

export const PdfPage = memo(function PdfPage({ pdf, page, index, scale, ann, tool, near, onAnn, onHighlightClick, onTouchPan, bookmarked, onDraft }: PageProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const textLayer = useRef<HTMLDivElement>(null);
  const live = useRef<SVGPathElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState(0);
  const [editingText, setEditingText] = useState<string | null>(null);
  const annRef = useRef(ann);
  annRef.current = ann;
  const W = page.w * scale;
  const H = page.h * scale;

  /* ----- render the PDF page bitmap (debounced on zoom) ----- */
  useEffect(() => {
    if (!near || !pdf || !page.src) return;
    let task: RenderTask | null = null;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const p = await pdf.getPage(page.src!);
        if (cancelled) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
        let s = scale * dpr;
        const base = p.getViewport({ scale: 1 });
        if (base.width * base.height * s * s > MAX_PIXELS) s = Math.sqrt(MAX_PIXELS / (base.width * base.height));
        const vp = p.getViewport({ scale: s });
        const off = document.createElement('canvas');
        off.width = Math.floor(vp.width);
        off.height = Math.floor(vp.height);
        task = p.render({ canvas: off, viewport: vp });
        await task.promise;
        if (cancelled || !canvas.current) return;
        const c = canvas.current;
        c.width = off.width;
        c.height = off.height;
        c.getContext('2d')!.drawImage(off, 0, 0);
        setRendered((n) => n + 1);
      } catch (e: any) {
        if (e?.name !== 'RenderingCancelledException') console.warn('PDF render failed', e);
      }
    }, rendered ? 160 : 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
      task?.cancel();
    };
  }, [near, pdf, page.src, scale]);

  // Free memory for far-away pages.
  useEffect(() => {
    if (!near && canvas.current && rendered) {
      canvas.current.width = 0;
      canvas.current.height = 0;
      setRendered(0);
    }
  }, [near]);

  /* ----- text layer (for selecting / highlighting text) ----- */
  useEffect(() => {
    if (!near || !pdf || !page.src || !textLayer.current) return;
    let cancelled = false;
    let layer: InstanceType<typeof pdfjs.TextLayer> | null = null;
    const el = textLayer.current;
    const t = setTimeout(async () => {
      const p = await pdf.getPage(page.src!);
      if (cancelled) return;
      el.replaceChildren();
      layer = new pdfjs.TextLayer({ textContentSource: p.streamTextContent(), container: el, viewport: p.getViewport({ scale }) });
      try {
        await layer.render();
        // pdf.js trick: an end-of-content element keeps selection from jumping.
        const end = document.createElement('div');
        end.className = 'endOfContent';
        el.append(end);
      } catch {}
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(t);
      layer?.cancel();
    };
  }, [near, pdf, page.src, scale]);

  /* ----- ink ----- */
  const erasing = useRef<PdfPageAnn | null>(null);
  const ink = useInkInput({
    active: () => tool === 'pen' || tool === 'highlighter' || tool === 'eraser',
    toLocal: (cx, cy) => {
      const r = box.current!.getBoundingClientRect();
      return [(cx - r.left) / scale, (cy - r.top) / scale];
    },
    // Stroke widths live in page units so ink scales with the page, like real paper.
    unit: () => 0.7,
    livePath: live,
    onStroke: (s: Stroke) => onAnn(page.key, { ...annRef.current, strokes: [...annRef.current.strokes, s] }),
    onErase: (x, y, r) => {
      const cur = erasing.current ?? annRef.current;
      const strokes = cur.strokes.filter((s) => !hitStroke(s, x, y, r));
      const highlights = cur.highlights.filter((h) => !h.rects.some(([hx, hy, hw, hh]) => x >= hx - r && x <= hx + hw + r && y >= hy - r && y <= hy + hh + r));
      if (strokes.length !== cur.strokes.length || highlights.length !== cur.highlights.length) {
        erasing.current = { ...cur, strokes, highlights };
        onAnn(page.key, erasing.current, false);
      }
    },
    onEraseEnd: () => {
      if (erasing.current) onAnn(page.key, erasing.current, true);
      erasing.current = null;
    },
    onTouchPan,
  });

  /* ----- text boxes ----- */
  const addTextBox = (e: React.PointerEvent) => {
    if (tool !== 'text' || (e.target as HTMLElement).closest('.pdf-textbox')) return;
    e.preventDefault();
    const r = box.current!.getBoundingClientRect();
    const tb: PdfTextBox = { id: uid(), x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale - 8, w: 200, text: '', color: 'ink', size: 12 };
    onAnn(page.key, { ...annRef.current, texts: [...annRef.current.texts, tb] });
    setEditingText(tb.id);
  };
  const updateText = (id: string, patch: Partial<PdfTextBox> | null) => {
    const texts = patch === null ? annRef.current.texts.filter((t) => t.id !== id) : annRef.current.texts.map((t) => (t.id === id ? { ...t, ...patch } : t));
    onAnn(page.key, { ...annRef.current, texts });
  };

  const onClick = (e: React.MouseEvent) => {
    if (tool !== 'select') return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    const r = box.current!.getBoundingClientRect();
    const x = (e.clientX - r.left) / scale, y = (e.clientY - r.top) / scale;
    for (const h of [...annRef.current.highlights].reverse()) {
      if (h.rects.some(([hx, hy, hw, hh]) => x >= hx && x <= hx + hw && y >= hy - 2 && y <= hy + hh + 2)) {
        onHighlightClick(page.key, h, { x: e.clientX, y: e.clientY });
        return;
      }
    }
  };

  const inking = tool === 'pen' || tool === 'highlighter' || tool === 'eraser';

  return (
    <div
      ref={box}
      className={`pdf-page ${page.src ? '' : 'is-blank'} tool-${tool}`}
      data-key={page.key}
      data-index={index}
      style={{ width: W, height: H, ['--total-scale-factor' as any]: scale, ['--scale-factor' as any]: scale }}
      onPointerDown={addTextBox}
      onClick={onClick}
    >
      {page.src ? <canvas ref={canvas} className="pdf-canvas" style={{ opacity: rendered ? 1 : 0 }} /> : null}
      {page.src && !rendered && <div className="pdf-page-loading">{index + 1}</div>}
      <div className="pdf-hl-layer">
        {ann.highlights.map((h) =>
          h.rects.map(([x, y, w, hh], i) => (
            <div
              key={h.id + i}
              className={`pdf-hl kind-${h.kind} ${h.comment ? 'has-comment' : ''}`}
              style={{ left: x * scale, top: y * scale, width: w * scale, height: hh * scale, ['--hl' as any]: solidColor(h.color) }}
            />
          )),
        )}
      </div>
      {page.src ? <div ref={textLayer} className={`textLayer ${tool === 'select' ? '' : 'is-off'}`} /> : null}
      <svg className={`pdf-ink ${inking ? 'is-on' : ''}`} viewBox={`0 0 ${page.w} ${page.h}`} width={W} height={H} {...(inking ? ink : {})}>
        <StrokePaths strokes={ann.strokes} paper />
        <path ref={live} />
      </svg>
      {ann.texts.map((t) => (
        <TextBox key={t.id} t={t} scale={scale} editing={editingText === t.id} tool={tool} onEdit={() => setEditingText(t.id)} onDone={() => (setEditingText(null), onDraft(page.key, t.id, null))} onDraft={(text) => onDraft(page.key, t.id, text)} onChange={(p) => updateText(t.id, p)} />
      ))}
      {bookmarked && <div className="pdf-bookmark" title="Bookmarked" />}
      {!page.src && <div className="pdf-blank-label">Inserted page</div>}
    </div>
  );
});

function TextBox({ t, scale, editing, tool, onEdit, onDone, onDraft, onChange }: { t: PdfTextBox; scale: number; editing: boolean; tool: PdfTool; onEdit: () => void; onDone: () => void; onDraft: (text: string) => void; onChange: (p: Partial<PdfTextBox> | null) => void }) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const [v, setV] = useState(t.text);
  useEffect(() => setV(t.text), [t.text]);
  useEffect(() => {
    if (editing) ta.current?.focus();
  }, [editing]);
  useLayoutEffect(() => {
    if (!ta.current) return;
    ta.current.style.height = '0';
    ta.current.style.height = ta.current.scrollHeight + 'px';
  }, [v, editing, scale]);
  const drag = (e: React.PointerEvent) => {
    if (editing) return;
    e.stopPropagation();
    e.preventDefault();
    const el = e.currentTarget.parentElement as HTMLElement;
    const sx = e.clientX, sy = e.clientY;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 3) moved = true;
      el.style.transform = `translate(${ev.clientX - sx}px, ${ev.clientY - sy}px)`;
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      el.style.transform = '';
      if (ev.type === 'pointercancel') return;
      if (moved) onChange({ x: t.x + (ev.clientX - sx) / scale, y: t.y + (ev.clientY - sy) / scale });
      else onEdit();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };
  return (
    <div
      className={`pdf-textbox ${editing ? 'is-editing' : ''} ${tool === 'select' || tool === 'text' ? 'is-live' : ''}`}
      style={{ left: t.x * scale, top: t.y * scale, width: t.w * scale, fontSize: t.size * scale, color: solidColor(t.color) }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {editing ? (
        <textarea
          ref={ta}
          value={v}
          placeholder="Type a note…"
          onChange={(e) => (setV(e.target.value), onDraft(e.target.value))}
          onBlur={() => {
            onDone();
            if (!v.trim()) onChange(null);
            else if (v !== t.text) onChange({ text: v });
          }}
          onKeyDown={(e) => (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) && (e.target as HTMLElement).blur()}
        />
      ) : (
        <div className="pdf-textbox-body" onPointerDown={drag}>
          {t.text}
        </div>
      )}
      {!editing && (tool === 'select' || tool === 'text') && (
        <button className="pdf-textbox-x" title="Delete" onPointerDown={(e) => (e.stopPropagation(), onChange(null))}>
          <X size={10} />
        </button>
      )}
    </div>
  );
}
