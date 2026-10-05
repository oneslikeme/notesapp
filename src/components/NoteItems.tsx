import { Pin, Hourglass } from 'lucide-react';
import type { NoteMeta } from '../lib/types';
import { useStore } from '../lib/store';
import { openNote } from '../lib/actions';
import { noteIcon, noteTitle, TYPE_INFO } from './noteTypes';
import { expiresIn, relTime } from '../lib/util';
import { DRAG_NOTE } from './Sidebar';

export function NoteCard({ n, onContext }: { n: NoteMeta; onContext?: (e: React.MouseEvent) => void }) {
  const Icon = noteIcon(n);
  return (
    <button
      className={`note-card type-${n.type}`}
      onClick={() => openNote(n.id)}
      onContextMenu={onContext}
      draggable
      onDragStart={(e) => e.dataTransfer.setData(DRAG_NOTE, JSON.stringify([n.id]))}
    >
      <div className="note-card-preview">
        {n.thumb ? <img src={n.thumb} alt="" draggable={false} /> : <p>{n.excerpt || <span className="muted">Empty</span>}</p>}
      </div>
      <div className="note-card-meta">
        <div className="note-card-title">
          <Icon size={14} strokeWidth={1.75} /> <span>{noteTitle(n)}</span>
        </div>
        <div className="note-card-sub">
          {TYPE_INFO[n.type].label} · {relTime(n.updatedAt)}
          {n.pinned && <Pin size={11} />}
        </div>
      </div>
    </button>
  );
}

export function NoteRow({
  n, showWhere, selected, onSelect, onContext, extra,
}: { n: NoteMeta; showWhere?: boolean; selected?: boolean; onSelect?: (e: React.MouseEvent) => void; onContext?: (e: React.MouseEvent) => void; extra?: React.ReactNode }) {
  const Icon = noteIcon(n);
  const nb = useStore((s) => (n.notebookId ? s.notebooks[n.notebookId]?.name : undefined));
  return (
    <div
      className={`note-row ${selected ? 'is-selected' : ''}`}
      role="button"
      tabIndex={0}
      onClick={(e) => (e.shiftKey || e.metaKey || e.ctrlKey) && onSelect ? onSelect(e) : openNote(n.id)}
      onKeyDown={(e) => e.key === 'Enter' && openNote(n.id)}
      onContextMenu={onContext}
      draggable
      onDragStart={(e) => e.dataTransfer.setData(DRAG_NOTE, JSON.stringify([n.id]))}
    >
      {onSelect && (
        <input
          type="checkbox"
          className="row-check"
          checked={!!selected}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onSelect(e as any)}
          aria-label="Select note"
        />
      )}
      <span className={`row-icon type-${n.type}`}>
        <Icon size={16} strokeWidth={1.75} />
      </span>
      <span className="row-main">
        <span className="row-title">
          {noteTitle(n)}
          {n.pinned && <Pin size={11} className="muted" />}
        </span>
        <span className="row-excerpt">{n.title ? n.excerpt : n.excerpt.slice(48)}</span>
      </span>
      <span className="row-side">
        {n.tags.slice(0, 3).map((t) => (
          <span key={t} className="tag is-static">#{t}</span>
        ))}
        {showWhere && <span className="row-where">{n.scratch ? 'Scratch' : nb ?? 'Inbox'}</span>}
        {n.scratch && n.expiresAt ? (
          <span className="scratch-badge is-static">
            <Hourglass size={11} /> {expiresIn(n.expiresAt)}
          </span>
        ) : null}
        {extra}
        <span className="row-time">{relTime(n.updatedAt)}</span>
      </span>
    </div>
  );
}
