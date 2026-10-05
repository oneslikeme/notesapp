import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownUp, Folder, FolderInput, Hash, Hourglass, Inbox, LayoutGrid, List, Pin, Plus, Trash, Files, RotateCcw, X, Save, Ellipsis, ChevronDown,
} from 'lucide-react';
import { useStore } from '../lib/store';
import type { Route } from '../lib/router';
import { navigate, paths } from '../lib/router';
import type { NoteMeta } from '../lib/types';
import { addTags, createNote, deleteForever, descendantNotebooks, emptyTrash, keepScratch, moveNotes, notebookPath, restoreNote, togglePin, updateMeta } from '../lib/actions';
import { NoteCard, NoteRow } from '../components/NoteItems';
import { askText, confirmDialog, Empty, IconBtn, openMenu, Segmented } from '../components/ui';
import { pickNotebook } from '../components/pickers';
import { noteMenu } from './noteMenu';
import { notebookMenu, newNoteMenuItems } from '../components/Sidebar';
import { dayBucket } from '../lib/util';
import { TYPE_INFO } from '../components/noteTypes';

type Sort = 'updated' | 'created' | 'title' | 'opened';

const lsGet = (k: string, d: string) => {
  try {
    return localStorage.getItem(k) ?? d;
  } catch {
    return d;
  }
};
const lsSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {}
};

export function NoteList({ route }: { route: Route }) {
  const notes = useStore((s) => s.notes);
  const notebooks = useStore((s) => s.notebooks);
  const [sort, setSort] = useState<Sort>(() => lsGet('list.sort', 'updated') as Sort);
  const [layout, setLayout] = useState<'list' | 'grid'>(() => lsGet('list.layout', 'list') as 'list' | 'grid');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [includeSub, setIncludeSub] = useState(true);
  useEffect(() => setSel(new Set()), [route.name, route.id]);
  useEffect(() => lsSet('list.sort', sort), [sort]);
  useEffect(() => lsSet('list.layout', layout), [layout]);

  const nb = route.name === 'notebook' && route.id ? notebooks[route.id] : undefined;
  const { title, icon: Icon, list, empty } = useMemo(() => {
    const all = Object.values(notes);
    const live = all.filter((n) => !n.trashedAt);
    switch (route.name) {
      case 'notebook': {
        const ids = includeSub && route.id ? descendantNotebooks(route.id) : new Set([route.id]);
        return { title: nb?.name ?? 'Notebook', icon: Folder, list: live.filter((n) => n.notebookId && ids.has(n.notebookId)), empty: 'This notebook is empty.' };
      }
      case 'tag':
        return { title: `#${route.id}`, icon: Hash, list: live.filter((n) => n.tags.some((t) => t.toLowerCase() === route.id?.toLowerCase())), empty: 'No notes with this tag.' };
      case 'inbox':
        return { title: 'Inbox', icon: Inbox, list: live.filter((n) => !n.notebookId && !n.scratch), empty: 'Notes without a notebook show up here.' };
      case 'pinned':
        return { title: 'Pinned', icon: Pin, list: live.filter((n) => n.pinned), empty: 'Pin notes you use often.' };
      case 'scratch':
        return { title: 'Scratch', icon: Hourglass, list: live.filter((n) => n.scratch), empty: 'Scratch notes are for quick, throwaway thoughts. They expire unless you keep them.' };
      case 'trash':
        return { title: 'Trash', icon: Trash, list: all.filter((n) => n.trashedAt), empty: 'Trash is empty. Notes here are deleted after 30 days.' };
      default:
        return { title: 'All notes', icon: Files, list: live, empty: 'No notes yet.' };
    }
  }, [notes, route, nb, includeSub]);

  const sorted = useMemo(() => {
    const l = typeFilter === 'all' ? [...list] : list.filter((n) => n.type === typeFilter);
    if (route.name === 'scratch') return l.sort((a, b) => (a.expiresAt ?? 0) - (b.expiresAt ?? 0));
    if (route.name === 'trash') return l.sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0));
    switch (sort) {
      case 'title':
        return l.sort((a, b) => (a.title || 'zzz').localeCompare(b.title || 'zzz', undefined, { numeric: true }));
      case 'created':
        return l.sort((a, b) => b.createdAt - a.createdAt);
      case 'opened':
        return l.sort((a, b) => b.openedAt - a.openedAt);
      default:
        return l.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
    }
  }, [list, sort, typeFilter, route.name]);

  const subNotebooks = route.name === 'notebook' ? Object.values(notebooks).filter((n) => n.parentId === route.id).sort((a, b) => a.name.localeCompare(b.name)) : [];
  const crumbs = nb ? notebookPath(nb.id).slice(0, -1) : [];
  const types = [...new Set(list.map((n) => n.type))];
  const isTrash = route.name === 'trash';
  const selIds = [...sel];

  const toggle = (id: string) => setSel((s) => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const newHere = () => (route.name === 'scratch' ? createNote('page', { scratch: true }) : createNote('page', { notebookId: nb?.id ?? null, tags: route.name === 'tag' && route.id ? [route.id] : [] }));

  let bucket = '';
  return (
    <div className="view">
      <div className="view-inner">
        <header className="view-head">
          <div>
            {crumbs.length > 0 && (
              <div className="view-crumbs">
                {crumbs.map((c) => (
                  <button key={c.id} className="crumb" onClick={() => navigate(paths.notebook(c.id))}>{c.name} /</button>
                ))}
              </div>
            )}
            <h1 className="view-title">
              <Icon size={22} strokeWidth={1.6} /> {title}
              {nb && <IconBtn icon={Ellipsis} label="Notebook options" onClick={(e) => notebookMenu(nb, e.currentTarget)} />}
            </h1>
            <div className="view-sub muted">{sorted.length} {sorted.length === 1 ? 'note' : 'notes'}</div>
          </div>
          <div className="view-actions">
            {isTrash ? (
              list.length > 0 && (
                <button className="btn is-danger" onClick={async () => (await confirmDialog({ title: 'Empty trash?', body: `Permanently delete ${list.length} notes. This can't be undone.`, confirm: 'Empty trash', danger: true })) && emptyTrash()}>
                  Empty trash
                </button>
              )
            ) : (
              <>
                {route.name !== 'scratch' && (
                  <button
                    className="btn"
                    onClick={(e) =>
                      openMenu(e.currentTarget, [
                        { header: 'Sort by' },
                        { label: 'Last edited', checked: sort === 'updated', onClick: () => setSort('updated') },
                        { label: 'Last opened', checked: sort === 'opened', onClick: () => setSort('opened') },
                        { label: 'Created', checked: sort === 'created', onClick: () => setSort('created') },
                        { label: 'Title', checked: sort === 'title', onClick: () => setSort('title') },
                        ...(route.name === 'notebook' && subNotebooks.length ? ['sep' as const, { label: 'Include sub-notebooks', checked: includeSub, onClick: () => setIncludeSub((v) => !v) }] : []),
                      ])
                    }
                  >
                    <ArrowDownUp size={14} /> {sort === 'updated' ? 'Edited' : sort === 'opened' ? 'Opened' : sort === 'created' ? 'Created' : 'Title'}
                  </button>
                )}
                <Segmented
                  value={layout}
                  onChange={setLayout}
                  options={[
                    { value: 'list', label: <List size={15} />, title: 'List' },
                    { value: 'grid', label: <LayoutGrid size={15} />, title: 'Grid' },
                  ]}
                />
                <div className="split-btn">
                  <button className="btn is-primary" onClick={newHere}>
                    <Plus size={15} /> New
                  </button>
                  <button className="btn is-primary split-more" aria-label="More" onClick={(e) => openMenu(e.currentTarget, newNoteMenuItems(), { alignRight: true })}>
                    <ChevronDown size={14} />
                  </button>
                </div>
              </>
            )}
          </div>
        </header>

        {types.length > 1 && (
          <div className="filter-row">
            <button className={`chip ${typeFilter === 'all' ? 'is-on' : ''}`} onClick={() => setTypeFilter('all')}>All</button>
            {types.map((t) => (
              <button key={t} className={`chip ${typeFilter === t ? 'is-on' : ''}`} onClick={() => setTypeFilter(t)}>
                {TYPE_INFO[t].label}
              </button>
            ))}
          </div>
        )}

        {subNotebooks.length > 0 && (
          <div className="folder-row">
            {subNotebooks.map((s) => (
              <button key={s.id} className="folder-card" onClick={() => navigate(paths.notebook(s.id))} onContextMenu={(e) => (e.preventDefault(), notebookMenu(s, e.currentTarget.getBoundingClientRect()))}>
                <Folder size={16} strokeWidth={1.6} /> {s.name}
              </button>
            ))}
          </div>
        )}

        {sel.size > 0 && (
          <div className="bulk-bar">
            <span>{sel.size} selected</span>
            {isTrash ? (
              <>
                <button className="btn is-small" onClick={() => (selIds.forEach(restoreNote), setSel(new Set()))}><RotateCcw size={13} /> Restore</button>
                <button className="btn is-small is-danger" onClick={async () => { if (await confirmDialog({ title: `Delete ${sel.size} notes forever?`, confirm: 'Delete', danger: true })) { for (const id of selIds) await deleteForever(id, true); setSel(new Set()); } }}>
                  <X size={13} /> Delete forever
                </button>
              </>
            ) : (
              <>
                <button className="btn is-small" onClick={async () => { const r = await pickNotebook(); if (r) (await moveNotes(selIds, r.id), setSel(new Set())); }}><FolderInput size={13} /> Move</button>
                <button className="btn is-small" onClick={async () => { const t = await askText({ title: 'Add tag to selected notes', placeholder: 'tag' }); if (t) addTags(selIds, [t.replace(/^#/, '')]); }}><Hash size={13} /> Tag</button>
                <button className="btn is-small" onClick={() => selIds.forEach(togglePin)}><Pin size={13} /> Pin</button>
                {route.name === 'scratch' && <button className="btn is-small" onClick={() => (selIds.forEach(keepScratch), setSel(new Set()))}><Save size={13} /> Keep</button>}
                <button className="btn is-small is-danger" onClick={() => (selIds.forEach((id) => updateMeta(id, { trashedAt: Date.now() })), setSel(new Set()))}><Trash size={13} /> Trash</button>
              </>
            )}
            <span className="spacer" />
            <button className="btn is-small is-ghost" onClick={() => setSel(new Set(sorted.map((n) => n.id)))}>Select all</button>
            <button className="btn is-small is-ghost" onClick={() => setSel(new Set())}>Clear</button>
          </div>
        )}

        {!sorted.length ? (
          <Empty icon={Icon} title={empty} />
        ) : layout === 'grid' && !isTrash ? (
          <div className="card-grid">
            {sorted.map((n) => (
              <NoteCard key={n.id} n={n} onContext={(e) => noteMenu(e, n)} />
            ))}
          </div>
        ) : (
          <div className="row-list">
            {sorted.map((n: NoteMeta) => {
              let head = null;
              if (sort === 'updated' && !isTrash && route.name !== 'scratch' && !n.pinned) {
                const b = dayBucket(n.updatedAt);
                if (b !== bucket) head = <div className="list-bucket">{(bucket = b)}</div>;
              }
              return (
                <div key={n.id}>
                  {head}
                  <NoteRow
                    n={n}
                    showWhere={route.name !== 'notebook' && route.name !== 'inbox' && route.name !== 'scratch'}
                    selected={sel.has(n.id)}
                    onSelect={() => toggle(n.id)}
                    onContext={(e) => noteMenu(e, n)}
                    extra={
                      isTrash ? (
                        <button className="btn is-small" onClick={(e) => (e.stopPropagation(), restoreNote(n.id))}>Restore</button>
                      ) : route.name === 'scratch' ? (
                        <button className="btn is-small" onClick={(e) => (e.stopPropagation(), keepScratch(n.id))}>Keep</button>
                      ) : null
                    }
                  />
                </div>
              );
            })}
          </div>
        )}
        {route.name === 'scratch' && sorted.length > 0 && <p className="muted small list-foot">Scratch notes move to Trash when they expire. Change the default lifetime in Settings.</p>}
        {isTrash && <p className="muted small list-foot">Notes in Trash are permanently deleted after 30 days.</p>}
      </div>
    </div>
  );
}

