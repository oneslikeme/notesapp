import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ChevronRight, ClockFading, Copy, Download, Ellipsis, FolderInput, Hourglass, Info, Inbox, ListTree, Pin, PinOff, Plus, Save, Trash, X, Link2, Timer,
} from 'lucide-react';
import type { NoteMeta } from '../lib/types';
import { useStore, setState, toast } from '../lib/store';
import { duplicateNote, extendScratch, keepScratch, moveNotes, notebookPath, snapshot, togglePin, trashNote, updateMeta } from '../lib/actions';
import { IconBtn, openMenu } from './ui';
import { pickNotebook } from './pickers';
import { TYPE_INFO } from './noteTypes';
import { navigate, paths } from '../lib/router';
import { exportFormats, exportNote } from '../lib/export';
import { expiresIn, modKey, relTime } from '../lib/util';
import { liveEditors } from '../lib/editors';
import { flush } from '../lib/saver';

export function NoteHeader({ meta, compact, children }: { meta: NoteMeta; compact?: boolean; children?: React.ReactNode }) {
  const panel = useStore((s) => s.panel);
  const crumbs = notebookPath(meta.notebookId);
  const togglePanel = (p: 'info' | 'outline' | 'history') => setState((s) => ({ panel: s.panel === p ? null : p }));
  const hasOutline = meta.type === 'page' || meta.type === 'research';

  return (
    <>
      <div className={`note-toolbar ${compact ? 'is-compact' : ''}`}>
        <div className="crumbs">
          {meta.scratch ? (
            <button className="crumb" onClick={() => navigate('/scratch')}>
              <Hourglass size={14} /> Scratch
            </button>
          ) : (
            <>
              <button className="crumb" onClick={() => navigate(crumbs.length ? paths.notebook(crumbs[0].id) : '/inbox')}>
                {crumbs.length ? crumbs[0].name : <><Inbox size={14} /> Inbox</>}
              </button>
              {crumbs.slice(1).map((c) => (
                <span key={c.id} className="crumb-wrap">
                  <ChevronRight size={13} className="crumb-sep" />
                  <button className="crumb" onClick={() => navigate(paths.notebook(c.id))}>{c.name}</button>
                </span>
              ))}
            </>
          )}
          {compact && (
            <>
              <ChevronRight size={13} className="crumb-sep" />
              <InlineTitle meta={meta} />
            </>
          )}
        </div>
        {children}
        <div className="note-actions">
          {meta.scratch && meta.expiresAt && (
            <button
              className="scratch-badge"
              title="Scratch notes expire. Click for options."
              onClick={(e) =>
                openMenu(e.currentTarget, [
                  { header: `Expires ${new Date(meta.expiresAt!).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}` },
                  { label: 'Keep this note', icon: Save, onClick: () => keepScratch(meta.id) },
                  { label: 'Keep & move to notebook…', icon: FolderInput, onClick: async () => { const r = await pickNotebook(); if (r) moveNotes([meta.id], r.id); } },
                  'sep',
                  { label: 'Expire in 1 day', icon: Timer, onClick: () => extendScratch(meta.id, 1) },
                  { label: 'Expire in 7 days', icon: Timer, onClick: () => extendScratch(meta.id, 7) },
                  { label: 'Expire in 30 days', icon: Timer, onClick: () => extendScratch(meta.id, 30) },
                ])
              }
            >
              <Hourglass size={13} /> {expiresIn(meta.expiresAt)}
            </button>
          )}
          <IconBtn icon={meta.pinned ? PinOff : Pin} label={meta.pinned ? 'Unpin' : 'Pin'} active={meta.pinned} onClick={() => togglePin(meta.id)} />
          {hasOutline && <IconBtn icon={ListTree} label="Outline" active={panel === 'outline'} onClick={() => togglePanel('outline')} />}
          <IconBtn icon={Info} label="Info & backlinks" kbd={`${modKey} .`} active={panel === 'info'} onClick={() => togglePanel('info')} />
          <IconBtn icon={ClockFading} label="Version history" active={panel === 'history'} onClick={() => togglePanel('history')} />
          <IconBtn
            icon={Download}
            label="Export"
            onClick={(e) =>
              openMenu(
                e.currentTarget,
                [{ header: 'Export as' }, ...exportFormats(meta).map((f) => ({ label: f.label, hint: f.hint, onClick: async () => { await flush(meta.id); exportNote(meta.id, f.format).catch((err) => toast(`Export failed: ${err?.message || err}`)); } }))],
                { alignRight: true },
              )
            }
          />
          <IconBtn
            icon={Ellipsis}
            label="More"
            onClick={(e) =>
              openMenu(
                e.currentTarget,
                [
                  { label: 'Move to notebook…', icon: FolderInput, onClick: async () => { const r = await pickNotebook(); if (r) moveNotes([meta.id], r.id); } },
                  { label: 'Duplicate', icon: Copy, onClick: () => duplicateNote(meta.id) },
                  { label: 'Copy link reference', icon: Link2, hint: '[[…]]', onClick: () => (navigator.clipboard.writeText(`[[${meta.title || 'Untitled'}]]`), toast('Copied [[link]] — paste it into any note')) },
                  { label: 'Save a named version…', icon: Save, onClick: () => saveNamedVersion(meta.id) },
                  meta.scratch
                    ? { label: 'Keep (stop expiring)', icon: Save, onClick: () => keepScratch(meta.id) }
                    : { label: 'Turn into scratch note', icon: Hourglass, onClick: () => updateMeta(meta.id, { scratch: true, expiresAt: Date.now() + useStore.getState().settings.scratchDays * 86400000 }) },
                  'sep',
                  { header: `${TYPE_INFO[meta.type].label} · edited ${relTime(meta.updatedAt)}` },
                  { label: 'Move to Trash', icon: Trash, danger: true, onClick: () => trashNote(meta.id) },
                ],
                { alignRight: true },
              )
            }
          />
        </div>
      </div>
      {!compact && (
        <div className="note-head">
          <BigTitle meta={meta} />
          <TagRow meta={meta} />
        </div>
      )}
    </>
  );
}

export async function saveNamedVersion(id: string) {
  const { askText } = await import('./ui');
  const label = await askText({ title: 'Name this version', placeholder: 'e.g. Before restructuring', confirm: 'Save version' });
  if (!label) return;
  await flush(id);
  await snapshot(id, undefined, undefined, label);
  toast(`Saved version “${label}”`);
}

function BigTitle({ meta }: { meta: NoteMeta }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [v, setV] = useState(meta.title);
  useEffect(() => {
    if (document.activeElement !== ref.current) setV(meta.title);
  }, [meta.title]);
  useLayoutEffect(() => {
    const el = ref.current!;
    el.style.height = '0';
    el.style.height = el.scrollHeight + 'px';
  }, [v]);
  useEffect(() => {
    // Focus the title for brand-new empty notes.
    if (!meta.title && Date.now() - meta.createdAt < 1500) ref.current?.focus();
  }, [meta.id]);
  return (
    <textarea
      ref={ref}
      className="note-title"
      rows={1}
      value={v}
      placeholder="Untitled"
      spellCheck={false}
      onChange={(e) => {
        const t = e.target.value.replace(/\n/g, '');
        setV(t);
        updateMeta(meta.id, { title: t }, true);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || (e.key === 'ArrowDown' && ref.current?.selectionStart === v.length)) {
          e.preventDefault();
          liveEditors.get(meta.id)?.commands.focus('start');
        }
      }}
    />
  );
}

function InlineTitle({ meta }: { meta: NoteMeta }) {
  const [v, setV] = useState(meta.title);
  useEffect(() => setV(meta.title), [meta.title]);
  return (
    <input
      className="inline-title"
      value={v}
      placeholder="Untitled"
      size={Math.max(8, Math.min(48, v.length + 1))}
      onChange={(e) => {
        setV(e.target.value);
        updateMeta(meta.id, { title: e.target.value }, true);
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

export function TagRow({ meta }: { meta: NoteMeta }) {
  const [adding, setAdding] = useState(false);
  const [v, setV] = useState('');
  const notes = useStore((s) => s.notes);
  const allTags = [...new Set(Object.values(notes).flatMap((n) => n.tags))].filter((t) => !meta.tags.includes(t)).sort();
  const add = (t: string) => {
    const tag = t.trim().replace(/^#/, '');
    if (tag && !meta.tags.some((x) => x.toLowerCase() === tag.toLowerCase())) updateMeta(meta.id, { tags: [...meta.tags, tag] }, true);
    setV('');
  };
  const suggestions = v ? allTags.filter((t) => t.toLowerCase().startsWith(v.toLowerCase())).slice(0, 6) : [];
  return (
    <div className="tag-row">
      {meta.tags.map((t) => (
        <span key={t} className="tag">
          <button className="tag-label" onClick={() => navigate(paths.tag(t))}>#{t}</button>
          <button className="tag-x" aria-label={`Remove ${t}`} onClick={() => updateMeta(meta.id, { tags: meta.tags.filter((x) => x !== t) }, true)}>
            <X size={11} />
          </button>
        </span>
      ))}
      {adding ? (
        <span className="tag-input-wrap">
          <input
            autoFocus
            className="tag-input"
            value={v}
            placeholder="tag"
            onChange={(e) => setV(e.target.value.replace(/[\s,]/g, '-'))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') {
                if (v) e.preventDefault();
                add(suggestions[0] && e.key === 'Tab' ? suggestions[0] : v);
              }
              if (e.key === 'Escape') (setAdding(false), setV(''));
              if (e.key === 'Backspace' && !v && meta.tags.length) updateMeta(meta.id, { tags: meta.tags.slice(0, -1) }, true);
            }}
            onBlur={() => (v && add(v), setAdding(false))}
          />
          {suggestions.length > 0 && (
            <span className="tag-suggest">
              {suggestions.map((s) => (
                <button key={s} onMouseDown={(e) => (e.preventDefault(), add(s))}>#{s}</button>
              ))}
            </span>
          )}
        </span>
      ) : (
        <button className="tag-add" onClick={() => setAdding(true)}>
          <Plus size={12} /> {meta.tags.length ? '' : 'Add tag'}
        </button>
      )}
    </div>
  );
}
