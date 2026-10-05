import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, Download, GripVertical, Mic, Pause, Play, Square, Trash, X, Grid3x3, Rows3, Circle } from 'lucide-react';
import { useInkInput } from '../../lib/useInk';
import { hitStroke, strokeBBox } from '../../lib/ink';
import { StrokePaths } from '../../components/StrokePaths';
import { InkControls } from '../../components/InkToolbar';
import { useStore } from '../../lib/store';
import type { Stroke } from '../../lib/types';
import { useRecorder } from '../../lib/recorder';
import { blobUrl, getBlob, putBlob } from '../../lib/blobs';
import { capturePointer, downloadBlob, fmtDuration } from '../../lib/util';
import { openNote } from '../../lib/actions';
import { noteTitle } from '../../components/noteTypes';
import { askText, Modal, openDialog } from '../../components/ui';

/* ================= Handwriting block ================= */

export function InkBlockView({ node, updateAttributes, deleteNode, selected, editor }: ReactNodeViewProps) {
  const strokes: Stroke[] = node.attrs.strokes || [];
  const height: number = node.attrs.height || 220;
  const [local, setLocal] = useState<Stroke[] | null>(null);
  const shown = local ?? strokes;
  const surf = useRef<HTMLDivElement>(null);
  const live = useRef<SVGPathElement>(null);
  const [focused, setFocused] = useState(false);
  const erasing = useRef<Stroke[] | null>(null);

  const ink = useInkInput({
    active: () => editor.isEditable,
    toLocal: (x, y) => {
      const r = surf.current!.getBoundingClientRect();
      return [x - r.left, y - r.top];
    },
    livePath: live,
    onBegin: () => setFocused(true),
    onStroke: (s) => {
      const b = strokeBBox(s);
      const grow = b.y1 > height - 50 ? Math.ceil((b.y1 + 120 - height) / 40) * 40 : 0;
      updateAttributes({ strokes: [...strokes, s], ...(grow ? { height: height + grow } : {}) });
    },
    onErase: (x, y, r) => {
      const cur = erasing.current ?? strokes;
      const next = cur.filter((s) => !hitStroke(s, x, y, r));
      if (next.length !== cur.length) {
        erasing.current = next;
        setLocal(next);
      }
    },
    onEraseEnd: () => {
      if (erasing.current) updateAttributes({ strokes: erasing.current });
      erasing.current = null;
      setLocal(null);
    },
    onTouchPan: (_dx, dy) => surf.current?.closest('.note-scroll')?.scrollBy(0, -dy),
  });

  // Resize handle
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startH = height;
    const el = e.currentTarget as HTMLElement;
    capturePointer(el, e.pointerId);
    const move = (ev: PointerEvent) => {
      const h = Math.max(80, Math.round((startH + ev.clientY - startY) / 10) * 10);
      surf.current!.style.height = h + 'px';
    };
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      updateAttributes({ height: Math.max(80, Math.round((startH + ev.clientY - startY) / 10) * 10) });
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  useEffect(() => {
    if (!focused) return;
    const off = (e: PointerEvent) => {
      if (!surf.current?.parentElement?.contains(e.target as Node)) setFocused(false);
    };
    window.addEventListener('pointerdown', off);
    return () => window.removeEventListener('pointerdown', off);
  }, [focused]);

  return (
    <NodeViewWrapper className={`ink-block ${selected || focused ? 'is-active' : ''}`} data-bg={node.attrs.bg}>
      <div className="ink-block-bar" contentEditable={false}>
        <span className="drag-grip" data-drag-handle draggable title="Drag to move">
          <GripVertical size={15} />
        </span>
        <InkControls compact />
        <div className="tool-group">
          {(['plain', 'lines', 'grid'] as const).map((bg) => (
            <button key={bg} className={`icon-btn ${node.attrs.bg === bg ? 'is-active' : ''}`} title={`${bg} paper`} onClick={() => updateAttributes({ bg })}>
              {bg === 'plain' ? <Circle size={14} /> : bg === 'lines' ? <Rows3 size={15} /> : <Grid3x3 size={15} />}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <button className="icon-btn" title="Delete drawing" onClick={() => deleteNode()}>
          <Trash size={15} />
        </button>
      </div>
      <div
        ref={surf}
        className="ink-surface"
        style={{ height }}
        contentEditable={false}
        onDragStart={(e) => e.preventDefault()}
        {...ink}
      >
        <svg className="ink-svg">
          <StrokePaths strokes={shown} />
          <path ref={live} />
        </svg>
        {!shown.length && <div className="ink-hint">Write or draw here</div>}
      </div>
      <div className="ink-resize" contentEditable={false} onPointerDown={startResize} title="Drag to resize" />
    </NodeViewWrapper>
  );
}

/* ================= Audio ================= */

export function AudioView({ node, updateAttributes, deleteNode }: ReactNodeViewProps) {
  const { blobId, duration, marks, createdAt } = node.attrs as { blobId: string | null; duration: number; marks: { t: number; label: string }[]; createdAt: number };
  return (
    <NodeViewWrapper className="audio-block" contentEditable={false}>
      <span className="drag-grip" data-drag-handle draggable>
        <GripVertical size={15} />
      </span>
      {blobId ? (
        <AudioPlayer blobId={blobId} duration={duration} marks={marks} onMarks={(m) => updateAttributes({ marks: m })} onDelete={deleteNode} />
      ) : (
        <AudioRecorderUI
          autostart={Date.now() - createdAt < 3000}
          onDone={async (res) => {
            if (!res) return deleteNode();
            const id = await putBlob(res.blob, `recording-${new Date().toISOString().slice(0, 16)}.webm`);
            updateAttributes({ blobId: id, duration: res.duration, marks: res.marks });
          }}
        />
      )}
    </NodeViewWrapper>
  );
}

export function AudioRecorderUI({ autostart, onDone }: { autostart?: boolean; onDone: (r: { blob: Blob; duration: number; marks: { t: number; label: string }[] } | null) => void }) {
  const rec = useRecorder();
  const marks = useRef<{ t: number; label: string }[]>([]);
  const [markCount, setMarkCount] = useState(0);
  useEffect(() => {
    if (autostart) rec.start();
  }, []);
  if (rec.state === 'idle') {
    return (
      <div className="audio-rec">
        <button className="rec-btn" onClick={() => rec.start()} title="Start recording">
          <Mic size={18} />
        </button>
        <span className="audio-label">{rec.error ?? 'Record audio'}</span>
        <span className="spacer" />
        <button className="icon-btn" title="Remove" onClick={() => onDone(null)}>
          <X size={16} />
        </button>
      </div>
    );
  }
  return (
    <div className="audio-rec is-live">
      <span className={`rec-dot ${rec.state === 'paused' ? 'is-paused' : ''}`} />
      <span className="audio-time">{fmtDuration(rec.elapsed)}</span>
      <div className="rec-level">
        <span style={{ transform: `scaleX(${rec.state === 'recording' ? 0.05 + rec.level * 0.95 : 0.02})` }} />
      </div>
      <button
        className="btn is-ghost is-small"
        title="Mark this moment"
        onClick={() => {
          marks.current.push({ t: rec.elapsedNow(), label: `Mark ${marks.current.length + 1}` });
          setMarkCount(marks.current.length);
        }}
      >
        <Bookmark size={14} /> Mark{markCount ? ` · ${markCount}` : ''}
      </button>
      {rec.state === 'recording' ? (
        <button className="icon-btn" title="Pause" onClick={rec.pause}>
          <Pause size={16} />
        </button>
      ) : (
        <button className="icon-btn" title="Resume" onClick={rec.resume}>
          <Mic size={16} />
        </button>
      )}
      <button
        className="btn is-small is-primary"
        onClick={async () => {
          const res = await rec.stop();
          onDone(res ? { ...res, marks: marks.current } : null);
        }}
      >
        <Square size={12} fill="currentColor" /> Stop
      </button>
    </div>
  );
}

const SPEEDS = [1, 1.25, 1.5, 2, 0.75];

export function AudioPlayer({ blobId, duration, marks = [], onMarks, onDelete }: { blobId: string; duration: number; marks?: { t: number; label: string }[]; onMarks?: (m: { t: number; label: string }[]) => void; onDelete?: () => void }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [speed, setSpeed] = useState(1);
  const total = duration || 0;
  useEffect(() => {
    blobUrl(blobId).then(setSrc);
  }, [blobId]);
  const seek = (sec: number) => {
    if (!audio.current) return;
    audio.current.currentTime = Math.max(0, Math.min(total || sec, sec));
    setT(audio.current.currentTime);
  };
  return (
    <div className="audio-player">
      <audio
        ref={audio}
        src={src ?? undefined}
        preload="metadata"
        onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      <div className="audio-row">
        <button className="play-btn" disabled={!src} onClick={() => (playing ? audio.current?.pause() : audio.current?.play())} title={playing ? 'Pause' : 'Play'}>
          {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
        </button>
        <span className="audio-time">
          {fmtDuration(t)} <span className="muted">/ {fmtDuration(total)}</span>
        </span>
        <div
          className="audio-bar"
          onPointerDown={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            seek(((e.clientX - r.left) / r.width) * total);
          }}
        >
          <div className="audio-fill" style={{ width: `${total ? (t / total) * 100 : 0}%` }} />
          {marks.map((m, i) => (
            <span key={i} className="audio-tick" style={{ left: `${total ? (m.t / total) * 100 : 0}%` }} title={`${m.label} · ${fmtDuration(m.t)}`} />
          ))}
        </div>
        <button
          className="btn is-ghost is-small speed"
          title="Playback speed"
          onClick={() => {
            const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
            setSpeed(next);
            if (audio.current) audio.current.playbackRate = next;
          }}
        >
          {speed}×
        </button>
        {onMarks && (
          <button className="icon-btn" title="Bookmark this moment" onClick={() => onMarks([...marks, { t, label: `Mark ${marks.length + 1}` }].sort((a, b) => a.t - b.t))}>
            <Bookmark size={15} />
          </button>
        )}
        <button
          className="icon-btn"
          title="Download recording"
          onClick={async () => {
            const b = await getBlob(blobId);
            if (b) downloadBlob(b, `recording.${b.type.includes('mp4') ? 'm4a' : 'webm'}`);
          }}
        >
          <Download size={15} />
        </button>
        {onDelete && (
          <button className="icon-btn" title="Delete recording" onClick={onDelete}>
            <Trash size={15} />
          </button>
        )}
      </div>
      {marks.length > 0 && (
        <div className="audio-marks">
          {marks.map((m, i) => (
            <button
              key={i}
              className="chip"
              onClick={() => (seek(m.t), audio.current?.play())}
              onDoubleClick={async () => {
                const label = await askText({ title: 'Rename bookmark', initial: m.label });
                if (label && onMarks) onMarks(marks.map((x, j) => (j === i ? { ...x, label } : x)));
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                onMarks?.(marks.filter((_, j) => j !== i));
              }}
              title="Click to play · double-click to rename · right-click to remove"
            >
              <span className="muted">{fmtDuration(m.t)}</span> {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ================= Image ================= */

export function ImageView({ node, updateAttributes, selected }: ReactNodeViewProps) {
  const { blobId, src, alt, width } = node.attrs;
  const [url, setUrl] = useState<string | null>(src);
  useEffect(() => {
    if (blobId) blobUrl(blobId).then(setUrl);
  }, [blobId]);
  return (
    <NodeViewWrapper className={`image-block ${selected ? 'is-selected' : ''}`} contentEditable={false}>
      <div className="image-frame" style={{ width: `${width}%` }} data-drag-handle draggable>
        {url ? <img src={url} alt={alt} draggable={false} onDoubleClick={() => openLightbox(url, alt)} /> : <div className="image-missing">Image unavailable</div>}
        <div className="image-tools">
          {[33, 50, 75, 100].map((w) => (
            <button key={w} className={`chip ${width === w ? 'is-on' : ''}`} onClick={() => updateAttributes({ width: w })}>
              {w === 100 ? 'Full' : `${w}%`}
            </button>
          ))}
        </div>
      </div>
    </NodeViewWrapper>
  );
}

export function openLightbox(url: string, alt = '') {
  openDialog((close) => (
    <Modal onClose={close} className="lightbox">
      <img src={url} alt={alt} onClick={close} />
    </Modal>
  ));
}

/* ================= Wiki link ================= */

export function WikiLinkView({ node }: ReactNodeViewProps) {
  const meta = useStore((s) => (node.attrs.id ? s.notes[node.attrs.id] : undefined));
  const title = meta ? noteTitle(meta) : node.attrs.title || 'Missing note';
  const broken = !meta || !!meta.trashedAt;
  return (
    <NodeViewWrapper as="span" className={`wikilink ${broken ? 'is-broken' : ''}`}>
      <a
        href={meta ? `#/note/${meta.id}` : undefined}
        onClick={(e) => {
          e.preventDefault();
          if (meta && !meta.trashedAt) openNote(meta.id);
        }}
        title={broken ? 'This note was deleted' : `Open “${title}”`}
      >
        {title}
      </a>
    </NodeViewWrapper>
  );
}

export function useStableStrokes(strokes: Stroke[]) {
  return useMemo(() => strokes, [strokes]);
}
