import { useMemo, useState } from 'react';
import {
  ChevronDown, ChevronRight, Files, Folder, FolderOpen, FolderPlus, Hash, Hourglass, House, Inbox, PanelLeft, Pencil, Plus, Search, Settings, Trash, Zap, Moon, Sun, FileUp, Shapes, Library, FileText, Upload,
} from 'lucide-react';
import { useStore, setState } from '../lib/store';
import { navigate, paths, useRoute } from '../lib/router';
import { createNote, createNotebook, deleteNotebook, moveNotes, openNote, updateNotebook, descendantNotebooks, setSettings } from '../lib/actions';
import { askText, confirmDialog, IconBtn, openMenu } from './ui';
import { noteIcon, noteTitle } from './noteTypes';
import type { Notebook } from '../lib/types';
import { modKey, pickFiles } from '../lib/util';
import { importFiles } from '../lib/importer';

export const DRAG_NOTE = 'application/x-inkwell-notes';

export function newNoteMenuItems() {
  return [
    { label: 'Page', icon: FileText, hint: 'Alt N', onClick: () => createNote('page') },
    { label: 'Canvas', icon: Shapes, onClick: () => createNote('canvas') },
    { label: 'Research', icon: Library, onClick: () => createNote('research') },
    { label: 'Scratch note', icon: Hourglass, hint: 'Alt ⇧ N', onClick: () => createNote('page', { scratch: true }) },
    'sep' as const,
    { label: 'Import PDF…', icon: FileUp, onClick: async () => importFiles(await pickFiles('application/pdf,.pdf', true)) },
    { label: 'Import files…', icon: Upload, hint: 'md, txt, html, images', onClick: async () => importFiles(await pickFiles('.md,.markdown,.txt,.html,.htm,image/*,.pdf,.zip,.json', true)) },
  ];
}

export function Sidebar() {
  const notes = useStore((s) => s.notes);
  const notebooks = useStore((s) => s.notebooks);
  const theme = useStore((s) => s.settings.theme);
  const route = useRoute();
  const live = useMemo(() => Object.values(notes).filter((n) => !n.trashedAt), [notes]);
  const pinned = live.filter((n) => n.pinned).sort((a, b) => a.title.localeCompare(b.title));
  const scratchCount = live.filter((n) => n.scratch).length;
  const inboxCount = live.filter((n) => !n.notebookId && !n.scratch).length;
  const trashCount = Object.values(notes).length - live.length;
  const tags = useMemo(() => {
    const m = new Map<string, number>();
    live.forEach((n) => n.tags.forEach((t) => m.set(t, (m.get(t) || 0) + 1)));
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [live]);
  const [allTags, setAllTags] = useState(false);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    live.forEach((n) => n.notebookId && m.set(n.notebookId, (m.get(n.notebookId) || 0) + 1));
    return m;
  }, [live]);

  const isOn = (name: string, id?: string) => route.name === name && (id === undefined || route.id === id);
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);

  return (
    <nav className="sidebar" aria-label="Sidebar">
      <div className="sb-top">
        <div className="brand">
          <span className="brand-mark" />
          Inkwell
        </div>
        <IconBtn icon={PanelLeft} label="Hide sidebar" kbd={`${modKey} \\`} onClick={() => setState({ sidebar: false })} />
      </div>
      <div className="sb-actions">
        <button className="sb-search" onClick={() => setState({ palette: 'jump' })}>
          <Search size={15} /> <span>Search or jump to…</span> <kbd className="kbd">{modKey} K</kbd>
        </button>
        <div className="sb-row">
          <button className="btn is-primary sb-new" onClick={() => createNote('page')} title="New page (Alt+N)">
            <Plus size={15} /> New page
          </button>
          <IconBtn icon={ChevronDown} label="More new options" className="sb-new-more" onClick={(e) => openMenu(e.currentTarget, newNoteMenuItems())} />
          <IconBtn icon={Zap} label="Quick capture" kbd="Alt Q" className="sb-capture" onClick={() => setState({ capture: true })} />
        </div>
      </div>

      <div className="sb-scroll">
        <div className="sb-group">
          <NavRow icon={House} label="Home" on={isOn('home')} onClick={() => navigate('/')} />
          <NavRow icon={Inbox} label="Inbox" count={inboxCount} on={isOn('inbox')} onClick={() => navigate('/inbox')} dropTo={null} />
          <NavRow icon={Files} label="All notes" count={live.length} on={isOn('all')} onClick={() => navigate('/all')} />
          <NavRow icon={Hourglass} label="Scratch" count={scratchCount} on={isOn('scratch')} onClick={() => navigate('/scratch')} />
        </div>

        {pinned.length > 0 && (
          <Section title="Pinned" onTitle={() => navigate('/pinned')}>
            {pinned.map((n) => {
              const Icon = noteIcon(n);
              return <NavRow key={n.id} icon={Icon} label={noteTitle(n)} on={isOn('note', n.id)} onClick={() => openNote(n.id)} noteId={n.id} />;
            })}
          </Section>
        )}

        <Section
          title="Notebooks"
          action={<IconBtn icon={FolderPlus} size={15} label="New notebook" onClick={async () => { const name = await askText({ title: 'New notebook', placeholder: 'Name', confirm: 'Create' }); if (name) navigate(paths.notebook((await createNotebook(name)).id)); }} />}
        >
          <NotebookTree parent={null} depth={0} notebooks={notebooks} counts={counts} activeId={route.name === 'notebook' ? route.id : undefined} />
          {!Object.keys(notebooks).length && <p className="sb-hint">Group notes by course, project or topic.</p>}
        </Section>

        {tags.length > 0 && (
          <Section title="Tags">
            <div className="sb-tags">
              {(allTags ? tags : tags.slice(0, 14)).map(([t, c]) => (
                <button key={t} className={`sb-tag ${isOn('tag', t) ? 'is-on' : ''}`} onClick={() => navigate(paths.tag(t))} title={`${c} notes`}>
                  <Hash size={11} />
                  {t}
                </button>
              ))}
              {tags.length > 14 && (
                <button className="sb-tag is-more" onClick={() => setAllTags((v) => !v)}>
                  {allTags ? 'less' : `+${tags.length - 14}`}
                </button>
              )}
            </div>
          </Section>
        )}
      </div>

      <div className="sb-bottom">
        <NavRow icon={Trash} label="Trash" count={trashCount || undefined} on={isOn('trash')} onClick={() => navigate('/trash')} />
        <div className="sb-row">
          <NavRow icon={Settings} label="Settings" on={isOn('settings')} onClick={() => navigate('/settings')} />
          <IconBtn icon={dark ? Sun : Moon} label={dark ? 'Light mode' : 'Dark mode'} onClick={() => setSettings({ theme: dark ? 'light' : 'dark' })} />
        </div>
      </div>
    </nav>
  );
}

function Section({ title, action, children, onTitle }: { title: string; action?: React.ReactNode; children: React.ReactNode; onTitle?: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="sb-section">
      <div className="sb-section-head">
        <button className="sb-section-title" onClick={() => (onTitle && open ? onTitle() : setOpen(!open))} onDoubleClick={() => setOpen(!open)}>
          {title}
        </button>
        <button className="sb-section-toggle" onClick={() => setOpen(!open)} aria-label={open ? 'Collapse' : 'Expand'}>
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        {action}
      </div>
      {open && children}
    </div>
  );
}

function NavRow({
  icon: Icon, label, count, on, onClick, dropTo, noteId, depth = 0, onMenu, prefix,
}: { icon: any; label: string; count?: number; on?: boolean; onClick: () => void; dropTo?: string | null; noteId?: string; depth?: number; onMenu?: (el: HTMLElement) => void; prefix?: React.ReactNode }) {
  const [over, setOver] = useState(false);
  const droppable = dropTo !== undefined;
  return (
    <div
      className={`nav-row ${on ? 'is-on' : ''} ${over ? 'is-drop' : ''}`}
      style={{ paddingLeft: 8 + depth * 14 }}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      draggable={!!noteId}
      onDragStart={(e) => noteId && e.dataTransfer.setData(DRAG_NOTE, JSON.stringify([noteId]))}
      onContextMenu={(e) => {
        if (!onMenu) return;
        e.preventDefault();
        onMenu(e.currentTarget);
      }}
      onDragOver={(e) => {
        if (droppable && e.dataTransfer.types.includes(DRAG_NOTE)) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        if (!droppable) return;
        const raw = e.dataTransfer.getData(DRAG_NOTE);
        if (!raw) return;
        e.preventDefault();
        e.stopPropagation();
        moveNotes(JSON.parse(raw), dropTo ?? null);
      }}
    >
      {prefix}
      <Icon size={15} strokeWidth={1.75} className="nav-icon" />
      <span className="nav-label">{label}</span>
      {count !== undefined && count > 0 && <span className="nav-count">{count}</span>}
    </div>
  );
}

function NotebookTree({ parent, depth, notebooks, counts, activeId }: { parent: string | null; depth: number; notebooks: Record<string, Notebook>; counts: Map<string, number>; activeId?: string }) {
  const children = Object.values(notebooks)
    .filter((n) => n.parentId === parent)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return (
    <>
      {children.map((nb) => {
        const hasKids = Object.values(notebooks).some((n) => n.parentId === nb.id);
        const total = [...descendantNotebooks(nb.id)].reduce((a, id) => a + (counts.get(id) || 0), 0);
        return (
          <div key={nb.id}>
            <NavRow
              icon={nb.collapsed || !hasKids ? Folder : FolderOpen}
              label={nb.name}
              count={total}
              depth={depth}
              on={activeId === nb.id}
              dropTo={nb.id}
              onClick={() => navigate(paths.notebook(nb.id))}
              prefix={
                <button
                  className={`nb-caret ${hasKids ? '' : 'is-hidden'}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    updateNotebook(nb.id, { collapsed: !nb.collapsed });
                  }}
                  aria-label={nb.collapsed ? 'Expand' : 'Collapse'}
                >
                  {nb.collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                </button>
              }
              onMenu={(el) => notebookMenu(nb, el)}
            />
            {hasKids && !nb.collapsed && <NotebookTree parent={nb.id} depth={depth + 1} notebooks={notebooks} counts={counts} activeId={activeId} />}
          </div>
        );
      })}
    </>
  );
}

export function notebookMenu(nb: Notebook, el: HTMLElement | DOMRect) {
  openMenu(el, [
    { label: 'New page here', icon: Plus, onClick: () => createNote('page', { notebookId: nb.id }) },
    { label: 'New sub-notebook', icon: FolderPlus, onClick: async () => { const name = await askText({ title: `New notebook inside “${nb.name}”`, confirm: 'Create' }); if (name) await createNotebook(name, nb.id); } },
    { label: 'Rename', icon: Pencil, onClick: async () => { const name = await askText({ title: 'Rename notebook', initial: nb.name, confirm: 'Rename' }); if (name) updateNotebook(nb.id, { name }); } },
    { label: 'Move into…', icon: Folder, onClick: async () => {
      const { pickNotebook } = await import('./pickers');
      const r = await pickNotebook('Move notebook into…');
      if (r && r.id !== nb.id && !(r.id && descendantNotebooks(nb.id).has(r.id))) updateNotebook(nb.id, { parentId: r.id });
    } },
    'sep',
    { label: 'Delete notebook', icon: Trash, danger: true, onClick: async () => {
      if (await confirmDialog({ title: `Delete “${nb.name}”?`, body: 'Its notes and sub-notebooks move up one level — no notes are deleted.', confirm: 'Delete notebook', danger: true })) {
        await deleteNotebook(nb.id);
        navigate('/');
      }
    } },
  ]);
}
