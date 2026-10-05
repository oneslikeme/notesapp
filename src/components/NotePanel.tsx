import { useEffect, useMemo, useState } from 'react';
import { diffWords } from 'diff';
import { ClockFading, RotateCcw, Save, X, Eye } from 'lucide-react';
import { useStore, setState } from '../lib/store';
import type { NoteMeta, Version } from '../lib/types';
import { listVersions, openNote, restoreVersion, notebookPath } from '../lib/actions';
import { allNoteTexts, highlightTerms, noteText } from '../lib/search';
import { noteIcon, noteTitle, TYPE_INFO } from './noteTypes';
import { fullDate, relTime, dayBucket } from '../lib/util';
import { IconBtn, Modal, openDialog, confirmDialog } from './ui';
import { liveEditors } from '../lib/editors';
import { flush } from '../lib/saver';
import { saveNamedVersion, TagRow } from './NoteHeader';

export function NotePanel({ meta }: { meta: NoteMeta }) {
  const panel = useStore((s) => s.panel);
  if (!panel) return null;
  const title = panel === 'info' ? 'Info' : panel === 'outline' ? 'Outline' : 'History';
  return (
    <aside className="note-panel">
      <div className="panel-head">
        <div className="panel-tabs">
          {(['info', 'outline', 'history'] as const)
            .filter((p) => p !== 'outline' || meta.type === 'page' || meta.type === 'research')
            .map((p) => (
              <button key={p} className={panel === p ? 'is-on' : ''} onClick={() => setState({ panel: p })}>
                {p === 'info' ? 'Info' : p === 'outline' ? 'Outline' : 'History'}
              </button>
            ))}
        </div>
        <IconBtn icon={X} label={`Close ${title}`} onClick={() => setState({ panel: null })} />
      </div>
      <div className="panel-body">
        {panel === 'info' && <InfoPanel meta={meta} />}
        {panel === 'outline' && <OutlinePanel meta={meta} />}
        {panel === 'history' && <HistoryPanel meta={meta} />}
      </div>
    </aside>
  );
}

/* ---------------- Info + backlinks ---------------- */

function contextSnippet(text: string, needle: string) {
  const i = text.toLowerCase().indexOf(needle.toLowerCase());
  if (i < 0) return text.slice(0, 140);
  const s = Math.max(0, i - 60);
  return (s ? '…' : '') + text.slice(s, i + needle.length + 80).replace(/\s+/g, ' ') + '…';
}

function InfoPanel({ meta }: { meta: NoteMeta }) {
  const notes = useStore((s) => s.notes);
  const title = meta.title.trim();
  const backlinks = useMemo(() => Object.values(notes).filter((n) => !n.trashedAt && n.id !== meta.id && n.links.includes(meta.id)), [notes, meta.id]);
  const outgoing = meta.links.map((id) => notes[id]).filter((n) => n && !n.trashedAt);
  const mentions = useMemo(() => {
    if (title.length < 3) return [];
    const out: { n: NoteMeta; snip: string }[] = [];
    const needle = title.toLowerCase();
    for (const [docId, text] of allNoteTexts()) {
      if (docId.includes('::')) continue;
      const n = notes[docId];
      if (!n || n.trashedAt || n.id === meta.id || n.links.includes(meta.id)) continue;
      if (text.toLowerCase().includes(needle)) out.push({ n, snip: contextSnippet(text, title) });
      if (out.length > 20) break;
    }
    return out;
  }, [notes, title, meta.id]);
  const nb = notebookPath(meta.notebookId).map((n) => n.name).join(' / ') || (meta.scratch ? 'Scratch' : 'Inbox');

  return (
    <div className="info">
      <section>
        <h4>Backlinks <span className="count">{backlinks.length}</span></h4>
        {backlinks.length ? (
          backlinks.map((n) => <LinkRow key={n.id} n={n} snippet={contextSnippet(noteText(n.id), title || '[[')} needle={title} />)
        ) : (
          <p className="muted small">No notes link here yet. Type <code>[[</code> in another note to link to this one.</p>
        )}
      </section>
      {outgoing.length > 0 && (
        <section>
          <h4>Links from this note <span className="count">{outgoing.length}</span></h4>
          {outgoing.map((n) => <LinkRow key={n!.id} n={n!} />)}
        </section>
      )}
      {mentions.length > 0 && (
        <section>
          <h4>Unlinked mentions <span className="count">{mentions.length}</span></h4>
          {mentions.map(({ n, snip }) => <LinkRow key={n.id} n={n} snippet={snip} needle={title} />)}
        </section>
      )}
      <section>
        <h4>Tags</h4>
        <TagRow meta={meta} />
      </section>
      <section className="details">
        <h4>Details</h4>
        <dl>
          <dt>Type</dt><dd>{TYPE_INFO[meta.type].label}{meta.scratch ? ' · scratch' : ''}</dd>
          <dt>Notebook</dt><dd>{nb}</dd>
          <dt>Created</dt><dd>{fullDate(meta.createdAt)}</dd>
          <dt>Modified</dt><dd>{fullDate(meta.updatedAt)}</dd>
          <dt>Words</dt><dd>{meta.words.toLocaleString()}</dd>
        </dl>
      </section>
    </div>
  );
}

function LinkRow({ n, snippet, needle }: { n: NoteMeta; snippet?: string; needle?: string }) {
  const Icon = noteIcon(n);
  return (
    <button className="link-row" onClick={() => openNote(n.id)}>
      <span className="link-row-title">
        <Icon size={14} strokeWidth={1.75} /> {noteTitle(n)}
      </span>
      {snippet && (
        <span className="link-row-snip">
          {highlightTerms(snippet, needle ? [needle] : []).map((p, i) => (p.hit ? <mark key={i}>{p.t}</mark> : <span key={i}>{p.t}</span>))}
        </span>
      )}
    </button>
  );
}

/* ---------------- Outline ---------------- */

function OutlinePanel({ meta }: { meta: NoteMeta }) {
  const [heads, setHeads] = useState<{ level: number; text: string; pos: number }[]>([]);
  useEffect(() => {
    const ed = liveEditors.get(meta.id);
    if (!ed) return;
    const read = () => {
      const out: { level: number; text: string; pos: number }[] = [];
      ed.state.doc.descendants((node, pos) => {
        if (node.type.name === 'heading') out.push({ level: node.attrs.level, text: node.textContent, pos });
        return node.type.name !== 'heading';
      });
      setHeads(out);
    };
    read();
    ed.on('update', read);
    return () => {
      ed.off('update', read);
    };
  }, [meta.id]);
  if (!heads.length) return <p className="muted small pad">Add headings (type <code>/</code> → Heading, or start a line with <code>#</code>) to build an outline.</p>;
  return (
    <div className="outline">
      {heads.map((h, i) => (
        <button
          key={i}
          className={`outline-row l${h.level}`}
          onClick={() => {
            const ed = liveEditors.get(meta.id);
            if (!ed) return;
            ed.chain().focus().setTextSelection(h.pos + 1).run();
            const dom = ed.view.nodeDOM(h.pos) as HTMLElement | null;
            dom?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
        >
          {h.text || 'Untitled heading'}
        </button>
      ))}
    </div>
  );
}

/* ---------------- History ---------------- */

function HistoryPanel({ meta }: { meta: NoteMeta }) {
  const [versions, setVersions] = useState<Version[] | null>(null);
  const updatedAt = meta.updatedAt;
  useEffect(() => {
    let alive = true;
    listVersions(meta.id).then((v) => alive && setVersions(v));
    return () => {
      alive = false;
    };
  }, [meta.id, updatedAt]);
  if (!versions) return null;
  let lastBucket = '';
  return (
    <div className="history">
      <button className="btn is-block" onClick={() => saveNamedVersion(meta.id)}>
        <Save size={14} /> Save a named version
      </button>
      <p className="muted small">Versions are saved automatically while you work (every {useStore.getState().settings.versionMinutes} min of editing).</p>
      {!versions.length && <p className="muted small">No versions yet.</p>}
      {versions.map((v) => {
        const b = dayBucket(v.createdAt);
        const head = b !== lastBucket ? ((lastBucket = b), <div key={b} className="history-bucket">{b}</div>) : null;
        return (
          <div key={v.id}>
            {head}
            <button className="history-row" onClick={() => previewVersion(meta, v)}>
              <span className="history-time">{new Date(v.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
              {v.label && <span className="history-label">{v.label}</span>}
              <span className="history-words muted">{(v.text.match(/\S+/g)?.length ?? 0).toLocaleString()} words</span>
              <Eye size={14} className="muted" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function previewVersion(meta: NoteMeta, v: Version) {
  openDialog((close) => <VersionPreview meta={meta} v={v} close={close} />);
}

function VersionPreview({ meta, v, close }: { meta: NoteMeta; v: Version; close: () => void }) {
  const current = noteText(meta.id);
  const parts = useMemo(() => diffWords(v.text, current), [v.text, current]);
  const added = parts.filter((p) => p.added).reduce((a, p) => a + (p.value.match(/\S+/g)?.length ?? 0), 0);
  const removed = parts.filter((p) => p.removed).reduce((a, p) => a + (p.value.match(/\S+/g)?.length ?? 0), 0);
  return (
    <Modal
      onClose={close}
      wide
      title={
        <span className="row gap">
          <ClockFading size={18} /> {v.label || 'Version'} · {relTime(v.createdAt)}
        </span>
      }
    >
      <p className="muted small">
        {fullDate(v.createdAt)} — compared with the current note: <span className="diff-add">+{added}</span> <span className="diff-del">−{removed}</span> words.
        Removed text since this version is <span className="diff-del">struck through</span>; text added later is <span className="diff-add">highlighted</span>.
      </p>
      {v.title !== meta.title && <p className="small">Title then: <strong>{v.title || 'Untitled'}</strong></p>}
      <div className="diff">
        {parts.map((p, i) => (
          <span key={i} className={p.added ? 'diff-add' : p.removed ? 'diff-del' : ''}>
            {p.value}
          </span>
        ))}
        {!parts.length && <span className="muted">This version has no text content (drawings, PDF ink, etc.).</span>}
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={close}>Close</button>
        <button
          className="btn is-primary"
          onClick={async () => {
            if (!(await confirmDialog({ title: 'Restore this version?', body: 'The current state is saved as a version first, so you can always go back.', confirm: 'Restore' }))) return;
            await flush(meta.id);
            await restoreVersion(v);
            close();
          }}
        >
          <RotateCcw size={14} /> Restore this version
        </button>
      </div>
    </Modal>
  );
}

