import { lazy, Suspense, useEffect, useState } from 'react';
import { FileQuestion, Image as ImageIcon, Mic, PenLine } from 'lucide-react';
import { insertImageFiles } from '../editors/page/suggest';
import { pickFiles } from '../lib/util';
import { useStore } from '../lib/store';
import { loadContent, restoreNote } from '../lib/actions';
import { flush, scheduleSave } from '../lib/saver';
import type { NoteContent, NoteMeta } from '../lib/types';
import { NoteHeader } from './NoteHeader';
import { NotePanel } from './NotePanel';
import { PageEditor } from '../editors/page/PageEditor';
import { liveEditors } from '../lib/editors';
import { Empty } from './ui';

const CanvasEditor = lazy(() => import('../editors/canvas/CanvasEditor'));
const PdfEditor = lazy(() => import('../editors/pdf/PdfEditor'));
const ResearchEditor = lazy(() => import('../editors/research/ResearchEditor'));

export function NoteView({ id, active }: { id: string; active: boolean }) {
  const meta = useStore((s) => s.notes[id]);
  const rev = useStore((s) => s.contentRev[id] || 0);
  const width = useStore((s) => s.settings.width);
  const font = useStore((s) => s.settings.font);
  // Content is tagged with the revision it was loaded at, so editors never remount with stale data.
  const [loaded, setLoaded] = useState<{ rev: number; c: NoteContent | null } | undefined>(undefined);
  const content = loaded?.c as NoteContent | null;

  useEffect(() => {
    let alive = true;
    loadContent(id).then((c) => alive && setLoaded({ rev, c: c ?? null }));
    return () => {
      alive = false;
      flush(id);
    };
  }, [id, rev]);

  if (!meta) return <Empty icon={FileQuestion} title="This note doesn't exist anymore" />;
  if (loaded === undefined) return <div className="note-view is-loading" />;
  if (content === null) return <Empty icon={FileQuestion} title="Couldn't load this note's content" />;

  const full = meta.type === 'canvas' || meta.type === 'pdf';
  const key = `${id}:${loaded.rev}`;

  return (
    <div className={`note-view type-${meta.type} w-${width} f-${font}`} data-active={active}>
      <div className="note-main">
        {meta.trashedAt && (
          <div className="trash-banner">
            This note is in the Trash. <button className="btn is-small" onClick={() => restoreNote(id)}>Restore</button>
          </div>
        )}
        {full ? (
          <>
            <NoteHeader meta={meta} compact />
            <Suspense fallback={<div className="note-loading" />}>
              {meta.type === 'canvas' ? <CanvasEditor key={key} meta={meta} doc={content.doc} active={active} /> : <PdfEditor key={key} meta={meta} doc={content.doc} active={active} />}
            </Suspense>
          </>
        ) : meta.type === 'research' ? (
          <Suspense fallback={<div className="note-loading" />}>
            <ResearchEditor key={key} meta={meta} doc={content.doc} />
          </Suspense>
        ) : (
          <div className="note-scroll">
            <NoteHeader meta={meta} />
            <PageBody key={key} meta={meta} doc={content.doc} />
          </div>
        )}
      </div>
      {active && <NotePanel meta={meta} />}
    </div>
  );
}

function PageBody({ meta, doc }: { meta: NoteMeta; doc: any }) {
  useEffect(() => () => void liveEditors.delete(meta.id), [meta.id]);
  const append = (node: any) => {
    const ed = liveEditors.get(meta.id);
    if (!ed) return;
    const end = ed.state.doc.content.size;
    ed.chain().insertContentAt(end, [node, { type: 'paragraph' }]).run();
    requestAnimationFrame(() => {
      const blocks = ed.view.dom.querySelectorAll('.ink-block, .audio-block, .image-block');
      blocks[blocks.length - 1]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };
  const addInk = () => append({ type: 'inkBlock', attrs: { strokes: [], height: 260 } });
  return (
    <div className="page-body">
      <PageEditor
        noteId={meta.id}
        initial={doc?.doc}
        onReady={(e) => liveEditors.set(meta.id, e)}
        onDirty={(get) => scheduleSave(meta.id, () => ({ doc: { doc: get() } }))}
      />
      <div
        className="page-tail"
        onPointerDown={(e) => {
          // A stylus touching the empty space below the text starts handwriting there.
          if (e.pointerType === 'pen' && e.target === e.currentTarget) {
            e.preventDefault();
            addInk();
          }
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) liveEditors.get(meta.id)?.commands.focus('end');
        }}
      >
        <div className="page-tail-actions">
          <button className="btn is-ghost is-small" onClick={addInk}>
            <PenLine size={14} /> Write by hand
          </button>
          <button className="btn is-ghost is-small" onClick={() => append({ type: 'audio', attrs: { createdAt: Date.now() } })}>
            <Mic size={14} /> Record audio
          </button>
          <button
            className="btn is-ghost is-small"
            onClick={async () => {
              const ed = liveEditors.get(meta.id);
              if (!ed) return;
              ed.commands.focus('end');
              insertImageFiles(ed, await pickFiles('image/*', true));
            }}
          >
            <ImageIcon size={14} /> Add image
          </button>
        </div>
      </div>
    </div>
  );
}
