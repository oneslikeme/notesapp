import { useMemo, useState } from 'react';
import { Folder, Inbox, Plus } from 'lucide-react';
import { Modal, openDialog } from './ui';
import { useStore } from '../lib/store';
import { titleSuggest } from '../lib/search';
import { noteIcon, noteTitle } from './noteTypes';
import type { NoteMeta, NoteType, Notebook } from '../lib/types';
import { relTime } from '../lib/util';
import { createNotebook } from '../lib/actions';

export function pickNote(opts: { title: string; types?: NoteType[]; exclude?: string; allowCreate?: NoteType }): Promise<NoteMeta | null | { create: string }> {
  return new Promise((resolve) => {
    openDialog((close) => <NotePicker {...opts} done={(v) => (close(), resolve(v))} />);
  });
}

function NotePicker({ title, types, exclude, allowCreate, done }: { title: string; types?: NoteType[]; exclude?: string; allowCreate?: NoteType; done: (v: NoteMeta | null | { create: string }) => void }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  useStore((s) => s.notes);
  const list = useMemo(() => titleSuggest(q, 60, exclude).filter((n) => !types || types.includes(n.type)).slice(0, 12), [q, types, exclude]);
  const total = list.length + (allowCreate && q.trim() ? 1 : 0);
  const choose = (i: number) => {
    if (i < list.length) done(list[i]);
    else if (allowCreate && q.trim()) done({ create: q.trim() });
  };
  return (
    <Modal onClose={() => done(null)} className="picker">
      <input
        className="picker-input"
        autoFocus
        placeholder={title}
        value={q}
        onChange={(e) => (setQ(e.target.value), setSel(0))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') (e.preventDefault(), setSel((s) => Math.min(total - 1, s + 1)));
          if (e.key === 'ArrowUp') (e.preventDefault(), setSel((s) => Math.max(0, s - 1)));
          if (e.key === 'Enter') (e.preventDefault(), choose(sel));
        }}
      />
      <div className="picker-list">
        {list.map((n, i) => {
          const Icon = noteIcon(n);
          return (
            <button key={n.id} className={`picker-row ${i === sel ? 'is-sel' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => choose(i)}>
              <Icon size={16} strokeWidth={1.75} />
              <span className="picker-title">{noteTitle(n)}</span>
              <span className="picker-meta">{relTime(n.updatedAt)}</span>
            </button>
          );
        })}
        {allowCreate && q.trim() && (
          <button className={`picker-row ${sel === list.length ? 'is-sel' : ''}`} onMouseEnter={() => setSel(list.length)} onClick={() => choose(list.length)}>
            <Plus size={16} />
            <span className="picker-title">Create “{q.trim()}”</span>
          </button>
        )}
        {!total && <div className="picker-empty">No matching notes</div>}
      </div>
    </Modal>
  );
}

export function pickNotebook(title = 'Move to…'): Promise<{ id: string | null } | null> {
  return new Promise((resolve) => {
    openDialog((close) => <NotebookPicker title={title} done={(v) => (close(), resolve(v))} />);
  });
}

export function notebookTree(notebooks: Record<string, Notebook>) {
  const all = Object.values(notebooks);
  const out: { nb: Notebook; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    all
      .filter((n) => n.parentId === parent)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      .forEach((nb) => {
        out.push({ nb, depth });
        walk(nb.id, depth + 1);
      });
  };
  walk(null, 0);
  return out;
}

function NotebookPicker({ title, done }: { title: string; done: (v: { id: string | null } | null) => void }) {
  const notebooks = useStore((s) => s.notebooks);
  const [q, setQ] = useState('');
  const tree = notebookTree(notebooks).filter((r) => !q || r.nb.name.toLowerCase().includes(q.toLowerCase()));
  const rows: { id: string | null; label: string; depth: number }[] = [
    ...(q ? [] : [{ id: null, label: 'Inbox', depth: 0 }]),
    ...tree.map((r) => ({ id: r.nb.id, label: r.nb.name, depth: q ? 0 : r.depth })),
  ];
  const [sel, setSel] = useState(0);
  const canCreate = q.trim() && !tree.some((r) => r.nb.name.toLowerCase() === q.trim().toLowerCase());
  const total = rows.length + (canCreate ? 1 : 0);
  const choose = async (i: number) => {
    if (i < rows.length) done({ id: rows[i].id });
    else if (canCreate) done({ id: (await createNotebook(q)).id });
  };
  return (
    <Modal onClose={() => done(null)} className="picker">
      <input
        className="picker-input"
        autoFocus
        placeholder={title}
        value={q}
        onChange={(e) => (setQ(e.target.value), setSel(0))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') (e.preventDefault(), setSel((s) => Math.min(total - 1, s + 1)));
          if (e.key === 'ArrowUp') (e.preventDefault(), setSel((s) => Math.max(0, s - 1)));
          if (e.key === 'Enter') (e.preventDefault(), choose(sel));
        }}
      />
      <div className="picker-list">
        {rows.map((r, i) => (
          <button key={r.id ?? 'inbox'} className={`picker-row ${i === sel ? 'is-sel' : ''}`} style={{ paddingLeft: 12 + r.depth * 16 }} onMouseEnter={() => setSel(i)} onClick={() => choose(i)}>
            {r.id ? <Folder size={16} strokeWidth={1.75} /> : <Inbox size={16} strokeWidth={1.75} />}
            <span className="picker-title">{r.label}</span>
          </button>
        ))}
        {canCreate && (
          <button className={`picker-row ${sel === rows.length ? 'is-sel' : ''}`} onMouseEnter={() => setSel(rows.length)} onClick={() => choose(rows.length)}>
            <Plus size={16} />
            <span className="picker-title">New notebook “{q.trim()}”</span>
          </button>
        )}
      </div>
    </Modal>
  );
}
