import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown, ArrowUp, BookOpenText, CornerDownLeft, ExternalLink, Image as ImageIcon, Link2, Quote, StickyNote, Trash, Search, FileUp, GripVertical,
} from 'lucide-react';
import type { Clip, ClipKind, NoteMeta, ResearchDoc } from '../../lib/types';
import { NoteHeader } from '../../components/NoteHeader';
import { PageEditor } from '../page/PageEditor';
import { scheduleSave } from '../../lib/saver';
import { liveEditors } from '../../lib/editors';
import { domainOf, looksLikeUrl, pickFiles, relTime, uid, escapeHtml } from '../../lib/util';
import { blobUrl, putBlob } from '../../lib/blobs';
import { importPdf } from '../../lib/importer';
import { openNote } from '../../lib/actions';
import { useStore } from '../../lib/store';
import { openLightbox } from '../page/nodeviews';
import { IconBtn } from '../../components/ui';

const KINDS: { kind: ClipKind | 'all'; label: string; icon?: any }[] = [
  { kind: 'all', label: 'All' },
  { kind: 'link', label: 'Links', icon: Link2 },
  { kind: 'quote', label: 'Quotes', icon: Quote },
  { kind: 'image', label: 'Images', icon: ImageIcon },
  { kind: 'pdf', label: 'PDFs', icon: BookOpenText },
  { kind: 'note', label: 'Notes', icon: StickyNote },
];

export default function ResearchEditor({ meta, doc }: { meta: NoteMeta; doc: ResearchDoc }) {
  const [question, setQuestion] = useState(doc?.question ?? '');
  const [clips, setClips] = useState<Clip[]>(doc?.clips ?? []);
  const [filter, setFilter] = useState<ClipKind | 'all'>('all');
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'notes' | 'sources'>('notes');
  const state = useRef({ question, clips, doc: doc?.doc });
  state.current.question = question;
  state.current.clips = clips;

  const save = useCallback(() => scheduleSave(meta.id, () => ({ doc: { ...state.current } })), [meta.id]);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) return void (first.current = false);
    save();
  }, [question, clips]);
  useEffect(() => () => void liveEditors.delete(meta.id), [meta.id]);

  const add = (c: Omit<Clip, 'id' | 'createdAt'>) => setClips((cs) => [{ ...c, id: uid(), createdAt: Date.now() }, ...cs]);
  const update = (id: string, patch: Partial<Clip>) => setClips((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const remove = (id: string) => setClips((cs) => cs.filter((c) => c.id !== id));
  const move = (id: string, dir: -1 | 1) =>
    setClips((cs) => {
      const i = cs.findIndex((c) => c.id === id);
      const j = i + dir;
      if (j < 0 || j >= cs.length) return cs;
      const next = [...cs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const addImages = async (files: File[]) => {
    for (const f of files.filter((f) => f.type.startsWith('image/'))) add({ kind: 'image', blobId: await putBlob(f, f.name), title: f.name.replace(/\.\w+$/, '') });
  };
  const addPdfs = async (files: File[]) => {
    for (const f of files.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name))) {
      const m = await importPdf(f, f.name, { open: false, notebookId: meta.notebookId });
      if (m) add({ kind: 'pdf', noteId: m.id, title: m.title });
    }
  };

  const insertIntoNotes = (c: Clip) => {
    const ed = liveEditors.get(meta.id);
    if (!ed) return;
    ed.chain().focus().insertContent(clipHtml(c)).run();
    setTab('notes');
  };

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return clips.filter((c) => (filter === 'all' || c.kind === filter) && (!s || [c.title, c.url, c.text, c.source, c.comment].some((x) => x?.toLowerCase().includes(s))));
  }, [clips, filter, q]);
  const counts = useMemo(() => clips.reduce<Record<string, number>>((a, c) => ((a[c.kind] = (a[c.kind] || 0) + 1), a), {}), [clips]);

  return (
    <div className="research">
      <div className="note-scroll research-scroll">
        <NoteHeader meta={meta} />
        <div className="research-question">
          <AutoText value={question} onChange={setQuestion} placeholder="What are you researching? (question, thesis, or brief)" className="rq-input" />
        </div>
        <div className="research-tabs">
          <button className={tab === 'notes' ? 'is-on' : ''} onClick={() => setTab('notes')}>My notes</button>
          <button className={tab === 'sources' ? 'is-on' : ''} onClick={() => setTab('sources')}>Sources & clips <span className="count">{clips.length}</span></button>
        </div>
        <div className="research-cols" data-tab={tab}>
          <div className="research-notes">
            <PageEditor
              noteId={meta.id}
              initial={doc?.doc}
              placeholder="Your own thinking goes here. Drag clips in from the sources column, type / for blocks, [[ to link notes."
              onReady={(e) => liveEditors.set(meta.id, e)}
              onDirty={(get) => {
                state.current.doc = get();
                save();
              }}
            />
          </div>
          <aside className="research-sources">
            <ClipInput onAdd={add} onImages={addImages} onPdfs={addPdfs} />
            <div className="clip-filters">
              {KINDS.map((k) =>
                k.kind === 'all' || counts[k.kind] ? (
                  <button key={k.kind} className={`chip ${filter === k.kind ? 'is-on' : ''}`} onClick={() => setFilter(k.kind)}>
                    {k.label} {k.kind !== 'all' && <span className="muted">{counts[k.kind]}</span>}
                  </button>
                ) : null,
              )}
              {clips.length > 5 && (
                <label className="clip-search">
                  <Search size={13} />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter" />
                </label>
              )}
            </div>
            <div className="clip-list">
              {!clips.length && (
                <div className="clip-empty">
                  <p>Collect what you find while researching:</p>
                  <ul>
                    <li>Paste a <strong>link</strong> or a <strong>quote</strong> above</li>
                    <li>Paste or drop a <strong>screenshot</strong></li>
                    <li>Attach <strong>PDFs</strong> — they open in the annotator</li>
                    <li>Highlight text in any PDF → <em>Send to note</em></li>
                  </ul>
                </div>
              )}
              {shown.map((c, i) => (
                <ClipCard key={c.id} c={c} first={i === 0} last={i === shown.length - 1} onChange={(p) => update(c.id, p)} onRemove={() => remove(c.id)} onMove={(d) => move(c.id, d)} onInsert={() => insertIntoNotes(c)} />
              ))}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function clipHtml(c: Clip) {
  const comment = c.comment ? `<p>${escapeHtml(c.comment)}</p>` : '';
  switch (c.kind) {
    case 'link':
      return `<p><a href="${escapeHtml(c.url || '')}">${escapeHtml(c.title || c.url || '')}</a></p>${comment}`;
    case 'quote': {
      const cite = c.noteId ? `<a data-wikilink data-id="${c.noteId}">${escapeHtml(c.source || 'source')}</a>` : escapeHtml(c.source || '');
      return `<blockquote><p>${escapeHtml(c.text || '')}</p>${cite || c.page ? `<p>— ${cite}${c.page ? `, p. ${c.page}` : ''}</p>` : ''}</blockquote>${comment}`;
    }
    case 'image':
      return `<img data-blob="${c.blobId}" alt="${escapeHtml(c.title || '')}">${comment}`;
    case 'pdf':
      return `<p><a data-wikilink data-id="${c.noteId}">${escapeHtml(c.title || 'PDF')}</a></p>${comment}`;
    default:
      return `<p>${escapeHtml(c.text || '')}</p>${comment}`;
  }
}

function ClipInput({ onAdd, onImages, onPdfs }: { onAdd: (c: Omit<Clip, 'id' | 'createdAt'>) => void; onImages: (f: File[]) => void; onPdfs: (f: File[]) => void }) {
  const [v, setV] = useState('');
  const [drag, setDrag] = useState(false);
  const submit = (text: string, pasted = false) => {
    const t = text.trim();
    if (!t) return;
    if (looksLikeUrl(t)) onAdd({ kind: 'link', url: t, title: '' });
    else onAdd({ kind: pasted ? 'quote' : 'note', text: t });
    setV('');
  };
  return (
    <div
      className={`clip-input ${drag ? 'is-drag' : ''}`}
      onDragOver={(e) => (e.preventDefault(), setDrag(true))}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDrag(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length) return onImages(files), onPdfs(files);
        const url = e.dataTransfer.getData('text/uri-list');
        const text = e.dataTransfer.getData('text/plain');
        submit(url || text, true);
      }}
    >
      <AutoText
        value={v}
        onChange={setV}
        placeholder="Paste a link, quote or screenshot…  (Enter to add)"
        className="clip-textarea"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit(v);
          }
        }}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.files);
          if (files.length) {
            e.preventDefault();
            onImages(files);
            onPdfs(files);
            return;
          }
          const text = e.clipboardData.getData('text/plain');
          if (!v.trim() && text.trim()) {
            e.preventDefault();
            submit(text, true);
          }
        }}
      />
      <div className="clip-add-row">
        <button className="chip" onClick={() => onAdd({ kind: 'link', url: '', title: '' })}><Link2 size={13} /> Link</button>
        <button className="chip" onClick={() => onAdd({ kind: 'quote', text: '' })}><Quote size={13} /> Quote</button>
        <button className="chip" onClick={async () => onImages(await pickFiles('image/*', true))}><ImageIcon size={13} /> Image</button>
        <button className="chip" onClick={async () => onPdfs(await pickFiles('application/pdf,.pdf', true))}><FileUp size={13} /> PDF</button>
        <button className="chip" onClick={() => onAdd({ kind: 'note', text: '' })}><StickyNote size={13} /> Note</button>
      </div>
    </div>
  );
}

function ClipCard({ c, first, last, onChange, onRemove, onMove, onInsert }: { c: Clip; first: boolean; last: boolean; onChange: (p: Partial<Clip>) => void; onRemove: () => void; onMove: (d: -1 | 1) => void; onInsert: () => void }) {
  const [img, setImg] = useState<string | null>(null);
  const linked = useStore((s) => (c.noteId ? s.notes[c.noteId] : undefined));
  useEffect(() => {
    if (c.blobId) blobUrl(c.blobId).then(setImg);
  }, [c.blobId]);
  const fresh = Date.now() - c.createdAt < 1500;
  const Icon = KINDS.find((k) => k.kind === c.kind)?.icon ?? StickyNote;
  return (
    <div
      className={`clip kind-${c.kind}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/html', clipHtml(c));
        e.dataTransfer.setData('text/plain', c.text || c.url || c.title || '');
        e.dataTransfer.effectAllowed = 'copy';
      }}
    >
      <div className="clip-head">
        <GripVertical size={13} className="clip-grip" />
        <Icon size={13} />
        <span className={`clip-kind ${c.kind === 'link' && c.url ? 'is-domain' : ''}`}>{c.kind === 'link' && c.url ? domainOf(c.url) : c.kind}</span>
        <span className="muted clip-time">{relTime(c.createdAt)}</span>
        <span className="spacer" />
        <div className="clip-actions">
          <IconBtn icon={CornerDownLeft} size={14} label="Insert into my notes" onClick={onInsert} />
          {(c.kind === 'link' && c.url) || c.noteId ? (
            <IconBtn icon={ExternalLink} size={14} label="Open" onClick={() => (c.noteId ? openNote(c.noteId, { page: c.page }) : window.open(c.url, '_blank', 'noopener'))} />
          ) : null}
          <IconBtn icon={ArrowUp} size={14} label="Move up" disabled={first} onClick={() => onMove(-1)} />
          <IconBtn icon={ArrowDown} size={14} label="Move down" disabled={last} onClick={() => onMove(1)} />
          <IconBtn icon={Trash} size={14} label="Remove clip" onClick={onRemove} />
        </div>
      </div>
      {c.kind === 'link' && (
        <>
          <AutoText className="clip-title" value={c.title || ''} onChange={(title) => onChange({ title })} placeholder="Title" />
          <AutoText className="clip-url" value={c.url || ''} onChange={(url) => onChange({ url })} placeholder="https://…" autoFocus={fresh && !c.url} />
        </>
      )}
      {c.kind === 'quote' && (
        <>
          <AutoText className="clip-quote" value={c.text || ''} onChange={(text) => onChange({ text })} placeholder="Quoted text" autoFocus={fresh && !c.text} />
          <div className="clip-source">
            —{' '}
            {c.noteId && linked ? (
              <button className="wikilink" onClick={() => openNote(c.noteId!, { page: c.page })}>
                {linked.title || c.source}{c.page ? `, p. ${c.page}` : ''}
              </button>
            ) : (
              <AutoText className="clip-source-input" value={c.source || ''} onChange={(source) => onChange({ source })} placeholder="Source (author, title, page…)" />
            )}
          </div>
        </>
      )}
      {c.kind === 'image' && img && <img className="clip-img" src={img} alt={c.title} onClick={() => openLightbox(img, c.title)} draggable={false} />}
      {c.kind === 'image' && <AutoText className="clip-title" value={c.title || ''} onChange={(title) => onChange({ title })} placeholder="Caption" />}
      {c.kind === 'pdf' && (
        <button className="clip-pdf" onClick={() => c.noteId && openNote(c.noteId)}>
          {linked?.thumb ? <img src={linked.thumb} alt="" /> : <BookOpenText size={22} />}
          <span>
            <strong>{linked?.title || c.title}</strong>
            <span className="muted small">{linked ? `PDF · ${linked.words ? `${linked.words} words annotated` : 'open to annotate'}` : 'Missing PDF'}</span>
          </span>
        </button>
      )}
      {c.kind === 'note' && <AutoText className="clip-note" value={c.text || ''} onChange={(text) => onChange({ text })} placeholder="Note" autoFocus={fresh && !c.text} />}
      <AutoText className="clip-comment" value={c.comment || ''} onChange={(comment) => onChange({ comment })} placeholder="Add your thoughts…" />
    </div>
  );
}

function AutoText({
  value, onChange, placeholder, className = '', autoFocus, onKeyDown, onPaste,
}: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; autoFocus?: boolean; onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void; onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current!;
    el.style.height = '0';
    el.style.height = el.scrollHeight + 'px';
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      className={`autotext ${className}`}
      value={value}
      placeholder={placeholder}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
    />
  );
}
