import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight, Download, FileText, FileUp, Files, FolderInput, Hourglass, House, Inbox, Keyboard, Library, Moon, PanelLeft, Pin, Plus, Search, Settings, Shapes, Trash, Zap, Archive, CornerDownLeft,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useStore, setState, getState } from '../lib/store';
import { search, titleSuggest, type Hit } from '../lib/search';
import { createNote, closeTab, moveNotes, openNote, setSettings, togglePin } from '../lib/actions';
import { navigate, paths, getRoute } from '../lib/router';
import { noteIcon, noteTitle, TYPE_INFO } from './noteTypes';
import { modKey, pickFiles, relTime } from '../lib/util';
import { importFiles } from '../lib/importer';
import { pickNotebook } from './pickers';

interface Cmd {
  id: string;
  label: string;
  icon: LucideIcon;
  hint?: string;
  run: () => void;
}

function commands(): Cmd[] {
  const route = getRoute();
  const cur = route.name === 'note' ? route.id : undefined;
  const list: Cmd[] = [
    { id: 'new-page', label: 'New page', icon: FileText, hint: 'Alt N', run: () => createNote('page') },
    { id: 'new-canvas', label: 'New canvas', icon: Shapes, run: () => createNote('canvas') },
    { id: 'new-research', label: 'New research note', icon: Library, run: () => createNote('research') },
    { id: 'new-scratch', label: 'New scratch note', icon: Hourglass, hint: 'Alt ⇧ N', run: () => createNote('page', { scratch: true }) },
    { id: 'capture', label: 'Quick capture', icon: Zap, hint: 'Alt Q', run: () => setState({ capture: true }) },
    { id: 'import-pdf', label: 'Import PDF…', icon: FileUp, run: async () => importFiles(await pickFiles('application/pdf,.pdf', true)) },
    { id: 'import', label: 'Import files…', icon: FileUp, run: async () => importFiles(await pickFiles('.md,.markdown,.txt,.html,.htm,image/*,.pdf,.zip,.json', true)) },
    { id: 'search', label: 'Search everything', icon: Search, hint: `${modKey} ⇧ F`, run: () => navigate(paths.search()) },
    { id: 'home', label: 'Go to Home', icon: House, run: () => navigate('/') },
    { id: 'inbox', label: 'Go to Inbox', icon: Inbox, run: () => navigate('/inbox') },
    { id: 'all', label: 'Go to All notes', icon: Files, run: () => navigate('/all') },
    { id: 'scratch', label: 'Go to Scratch', icon: Hourglass, run: () => navigate('/scratch') },
    { id: 'trash', label: 'Go to Trash', icon: Trash, run: () => navigate('/trash') },
    { id: 'settings', label: 'Settings', icon: Settings, run: () => navigate('/settings') },
    { id: 'theme', label: 'Toggle dark mode', icon: Moon, run: () => setSettings({ theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' }) },
    { id: 'sidebar', label: 'Toggle sidebar', icon: PanelLeft, hint: `${modKey} \\`, run: () => setState((s) => ({ sidebar: !s.sidebar })) },
    { id: 'shortcuts', label: 'Keyboard shortcuts', icon: Keyboard, hint: '?', run: () => setState({ shortcuts: true }) },
    { id: 'export-md', label: 'Export all notes as Markdown', icon: Download, run: async () => (await import('../lib/backup')).exportLibraryMarkdown() },
    { id: 'backup', label: 'Download full backup', icon: Archive, run: async () => (await import('../lib/backup')).exportBackup() },
  ];
  if (cur) {
    list.unshift(
      { id: 'pin', label: getState().notes[cur]?.pinned ? 'Unpin this note' : 'Pin this note', icon: Pin, run: () => togglePin(cur) },
      { id: 'move', label: 'Move this note to…', icon: FolderInput, run: async () => { const r = await pickNotebook(); if (r) moveNotes([cur], r.id); } },
      { id: 'close', label: 'Close tab', icon: ArrowRight, hint: 'Alt W', run: () => closeTab(cur) },
    );
  }
  return list;
}

type Row = { kind: 'note'; id: string; hit?: Hit } | { kind: 'cmd'; cmd: Cmd } | { kind: 'create'; title: string } | { kind: 'search'; q: string };

export function CommandPalette() {
  const mode = useStore((s) => s.palette);
  if (!mode) return null;
  return <Palette initial={mode === 'commands' ? '>' : ''} />;
}

function Palette({ initial }: { initial: string }) {
  const [q, setQ] = useState(initial);
  const [sel, setSel] = useState(0);
  const notes = useStore((s) => s.notes);
  const listRef = useRef<HTMLDivElement>(null);
  const close = () => setState({ palette: null });
  const isCmd = q.startsWith('>');
  const query = isCmd ? q.slice(1).trim() : q.trim();

  const rows: { section?: string; row: Row }[] = useMemo(() => {
    if (isCmd) {
      const s = query.toLowerCase();
      return commands().filter((c) => !s || c.label.toLowerCase().includes(s)).map((cmd) => ({ row: { kind: 'cmd', cmd } as Row }));
    }
    if (!query) {
      return titleSuggest('', 9).map((n, i) => ({ section: i === 0 ? 'Recent' : undefined, row: { kind: 'note', id: n.id } as Row }));
    }
    const titles = titleSuggest(query, 6);
    const seen = new Set(titles.map((t) => t.id));
    const hits = search(query, 12).filter((h) => !seen.has(h.noteId));
    const out: { section?: string; row: Row }[] = [];
    titles.forEach((n, i) => out.push({ section: i === 0 ? 'Notes' : undefined, row: { kind: 'note', id: n.id } }));
    hits.slice(0, 8).forEach((h, i) => out.push({ section: i === 0 ? 'Found in content' : undefined, row: { kind: 'note', id: h.noteId, hit: h } }));
    const cmdMatches = commands().filter((c) => c.label.toLowerCase().includes(query.toLowerCase())).slice(0, 3);
    cmdMatches.forEach((cmd, i) => out.push({ section: i === 0 ? 'Commands' : undefined, row: { kind: 'cmd', cmd } }));
    out.push({ section: 'Actions', row: { kind: 'search', q: query } });
    if (!titles.some((t) => t.title.toLowerCase() === query.toLowerCase())) out.push({ row: { kind: 'create', title: query } });
    return out;
  }, [q, notes]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector('.is-sel')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const run = (r: Row, e?: { shiftKey?: boolean }) => {
    close();
    if (r.kind === 'note') openNote(r.id, { page: r.hit?.page || undefined });
    else if (r.kind === 'cmd') r.cmd.run();
    else if (r.kind === 'create') createNote('page', { title: r.title, scratch: !!e?.shiftKey });
    else navigate(paths.search(r.q));
  };

  return (
    <div className="modal-backdrop palette-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog" aria-label="Command palette">
        <div className="palette-input">
          <Search size={18} />
          <input
            autoFocus
            value={q}
            placeholder="Jump to a note, search content, or type > for commands"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') return close();
              if (e.key === 'ArrowDown') return e.preventDefault(), setSel((s) => Math.min(rows.length - 1, s + 1));
              if (e.key === 'ArrowUp') return e.preventDefault(), setSel((s) => Math.max(0, s - 1));
              if (e.key === 'Enter') {
                e.preventDefault();
                if ((e.ctrlKey || e.metaKey) && query) return close(), navigate(paths.search(query));
                if (e.shiftKey && query && !isCmd) return run({ kind: 'create', title: query });
                if (rows[sel]) run(rows[sel].row, e);
              }
            }}
          />
        </div>
        <div className="palette-list" ref={listRef}>
          {rows.map(({ section, row }, i) => (
            <div key={i}>
              {section && <div className="palette-section">{section}</div>}
              <PaletteRow row={row} sel={i === sel} onHover={() => setSel(i)} onRun={() => run(row)} />
            </div>
          ))}
          {!rows.length && <div className="palette-empty">Nothing found</div>}
        </div>
        <div className="palette-foot">
          <span><kbd className="kbd">↵</kbd> open</span>
          <span><kbd className="kbd">⇧ ↵</kbd> new note</span>
          <span><kbd className="kbd">{modKey} ↵</kbd> full search</span>
          <span><kbd className="kbd">&gt;</kbd> commands</span>
        </div>
      </div>
    </div>
  );
}

function PaletteRow({ row, sel, onHover, onRun }: { row: Row; sel: boolean; onHover: () => void; onRun: () => void }) {
  const notes = useStore((s) => s.notes);
  const notebooks = useStore((s) => s.notebooks);
  let icon: LucideIcon = FileText;
  let title: React.ReactNode = '';
  let sub: React.ReactNode = null;
  let hint: React.ReactNode = null;
  if (row.kind === 'note') {
    const n = notes[row.id];
    if (!n) return null;
    icon = noteIcon(n);
    title = noteTitle(n);
    const where = n.scratch ? 'Scratch' : n.notebookId ? notebooks[n.notebookId]?.name : 'Inbox';
    if (row.hit && row.hit.snippet.length)
      sub = (
        <>
          {row.hit.page ? <span className="pill">p. {row.hit.page}</span> : null}
          {row.hit.snippet.map((p, i) => (p.hit ? <mark key={i}>{p.t}</mark> : <span key={i}>{p.t}</span>))}
        </>
      );
    hint = (
      <span className="palette-meta">
        {where} · {TYPE_INFO[n.type].label} · {relTime(n.updatedAt)}
      </span>
    );
  } else if (row.kind === 'cmd') {
    icon = row.cmd.icon;
    title = row.cmd.label;
    hint = row.cmd.hint ? <kbd className="kbd">{row.cmd.hint}</kbd> : null;
  } else if (row.kind === 'create') {
    icon = Plus;
    title = <>Create “{row.title}”</>;
    hint = <span className="palette-meta">⇧ ↵ for scratch</span>;
  } else {
    icon = Search;
    title = <>Search everywhere for “{row.q}”</>;
    hint = <CornerDownLeft size={13} className="muted" />;
  }
  const Icon = icon;
  return (
    <button className={`palette-row ${sel ? 'is-sel' : ''}`} onMouseMove={onHover} onClick={onRun}>
      <Icon size={16} strokeWidth={1.75} className="palette-icon" />
      <span className="palette-text">
        <span className="palette-title">{title}</span>
        {sub && <span className="palette-sub">{sub}</span>}
      </span>
      {hint}
    </button>
  );
}
