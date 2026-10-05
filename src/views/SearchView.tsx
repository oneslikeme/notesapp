import { useEffect, useMemo, useRef, useState } from 'react';
import { Search as SearchIcon, X, HelpCircle } from 'lucide-react';
import { useStore } from '../lib/store';
import { navigate, paths, type Route } from '../lib/router';
import { parseQuery, search } from '../lib/search';
import { openNote } from '../lib/actions';
import { noteIcon, noteTitle, TYPE_INFO } from '../components/noteTypes';
import { relTime } from '../lib/util';
import { noteMenu } from './noteMenu';
import type { NoteType } from '../lib/types';

export function SearchView({ route }: { route: Route }) {
  const initial = route.query.get('q') ?? '';
  const [q, setQ] = useState(initial);
  const [sel, setSel] = useState(0);
  const [help, setHelp] = useState(false);
  const notes = useStore((s) => s.notes);
  const notebooks = useStore((s) => s.notebooks);
  const indexing = useStore((s) => s.indexing);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => setQ(route.query.get('q') ?? ''), [route.query.get('q')]);
  useEffect(() => {
    const t = setTimeout(() => navigate(paths.search(q), true), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector('.is-sel')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const hits = useMemo(() => search(q, 100), [q, notes, indexing]);
  const parsed = parseQuery(q);
  const tags = useMemo(() => [...new Set(Object.values(notes).filter((n) => !n.trashedAt).flatMap((n) => n.tags))].sort(), [notes]);

  const toggleToken = (tok: string) => {
    const has = q.split(/\s+/).includes(tok);
    setQ(has ? q.split(/\s+/).filter((x) => x !== tok).join(' ') : `${q.trim()} ${tok}`.trim());
    input.current?.focus();
  };

  return (
    <div className="view search-view">
      <div className="view-inner">
        <div className="search-box">
          <SearchIcon size={20} />
          <input
            ref={input}
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search titles, text, PDFs, clips, tags…"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') (e.preventDefault(), setSel((s) => Math.min(hits.length - 1, s + 1)));
              if (e.key === 'ArrowUp') (e.preventDefault(), setSel((s) => Math.max(0, s - 1)));
              if (e.key === 'Enter' && hits[sel]) openNote(hits[sel].noteId, { page: hits[sel].page || undefined });
            }}
          />
          {q && <button className="icon-btn" onClick={() => setQ('')} aria-label="Clear"><X size={16} /></button>}
          <button className={`icon-btn ${help ? 'is-active' : ''}`} onClick={() => setHelp((h) => !h)} title="Search syntax"><HelpCircle size={16} /></button>
        </div>

        <div className="filter-row">
          {(['page', 'canvas', 'research', 'pdf'] as NoteType[]).map((t) => (
            <button key={t} className={`chip ${parsed.types.includes(t) ? 'is-on' : ''}`} onClick={() => toggleToken(`type:${t}`)}>
              {TYPE_INFO[t].label}
            </button>
          ))}
          <button className={`chip ${parsed.pinned ? 'is-on' : ''}`} onClick={() => toggleToken('is:pinned')}>Pinned</button>
          <button className={`chip ${parsed.scratch ? 'is-on' : ''}`} onClick={() => toggleToken('is:scratch')}>Scratch</button>
          <button className={`chip ${parsed.trashed ? 'is-on' : ''}`} onClick={() => toggleToken('is:trashed')}>In trash</button>
          {tags.length > 0 && (
            <select className="chip-select" value="" onChange={(e) => e.target.value && toggleToken(`tag:${e.target.value}`)}>
              <option value="">Tag…</option>
              {tags.map((t) => <option key={t} value={t}>#{t}</option>)}
            </select>
          )}
          {Object.keys(notebooks).length > 0 && (
            <select className="chip-select" value="" onChange={(e) => e.target.value && toggleToken(`in:"${e.target.value}"`)}>
              <option value="">Notebook…</option>
              {Object.values(notebooks).sort((a, b) => a.name.localeCompare(b.name)).map((n) => <option key={n.id} value={n.name}>{n.name}</option>)}
            </select>
          )}
        </div>

        {help && (
          <div className="search-help">
            <div><code>"exact phrase"</code> match words in order</div>
            <div><code>tag:biology</code> or <code>#biology</code> notes with a tag</div>
            <div><code>type:pdf</code> page · canvas · research · pdf</div>
            <div><code>in:"Notebook name"</code> limit to a notebook</div>
            <div><code>is:pinned</code> <code>is:scratch</code> <code>is:trashed</code></div>
            <div className="muted">Words match as prefixes and tolerate small typos. PDF text is searched page by page.</div>
          </div>
        )}

        <div className="search-meta muted small">
          {q.trim() ? `${hits.length}${hits.length === 100 ? '+' : ''} result${hits.length === 1 ? '' : 's'}` : 'Type to search everything in your library.'}
          {indexing && ' · indexing…'}
        </div>

        <div className="search-results" ref={listRef}>
          {hits.map((h, i) => {
            const n = notes[h.noteId];
            if (!n) return null;
            const Icon = noteIcon(n);
            const where = n.scratch ? 'Scratch' : n.notebookId ? notebooks[n.notebookId]?.name : 'Inbox';
            return (
              <button
                key={h.noteId}
                className={`search-hit ${i === sel ? 'is-sel' : ''}`}
                onMouseMove={() => setSel(i)}
                onClick={() => openNote(h.noteId, { page: h.page || undefined })}
                onContextMenu={(e) => noteMenu(e, n)}
              >
                <div className="hit-head">
                  <Icon size={15} strokeWidth={1.75} />
                  <span className="hit-title">{noteTitle(n)}</span>
                  <span className="hit-meta">
                    {where} · {relTime(n.updatedAt)}
                  </span>
                </div>
                {h.snippet.length > 0 && (
                  <div className="hit-snippet">
                    {h.page ? <span className="pill">p. {h.page}</span> : null}
                    {h.snippet.map((p, j) => (p.hit ? <mark key={j}>{p.t}</mark> : <span key={j}>{p.t}</span>))}
                  </div>
                )}
                {(h.more > 0 || n.tags.length > 0) && (
                  <div className="hit-foot">
                    {n.tags.map((t) => <span key={t} className="tag is-static">#{t}</span>)}
                    {h.more > 0 && <span className="muted small">+{h.more} more {n.type === 'pdf' ? 'pages' : 'matches'}</span>}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
