import { useState } from 'react';
import { ArrowLeft, ArrowRight, PanelLeft, Plus, X } from 'lucide-react';
import { useStore, setState } from '../lib/store';
import { useRoute } from '../lib/router';
import { closeTab, openNote, togglePin, trashNote } from '../lib/actions';
import { noteIcon, noteTitle } from './noteTypes';
import { IconBtn, openMenu } from './ui';
import { DRAG_NOTE, newNoteMenuItems } from './Sidebar';
import { modKey } from '../lib/util';

export function TabBar() {
  const tabs = useStore((s) => s.tabs);
  const notes = useStore((s) => s.notes);
  const sidebar = useStore((s) => s.sidebar);
  const route = useRoute();
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const activeId = route.name === 'note' ? route.id : undefined;

  return (
    <div className="tabbar">
      {!sidebar && <IconBtn icon={PanelLeft} label="Show sidebar" kbd={`${modKey} \\`} onClick={() => setState({ sidebar: true })} />}
      <IconBtn icon={ArrowLeft} label="Back" kbd="Alt ←" onClick={() => history.back()} className="nav-arrow" />
      <IconBtn icon={ArrowRight} label="Forward" kbd="Alt →" onClick={() => history.forward()} className="nav-arrow" />
      <div className="tabs" role="tablist">
        {tabs.map((id, i) => {
          const n = notes[id];
          if (!n) return null;
          const Icon = noteIcon(n);
          return (
            <div
              key={id}
              role="tab"
              aria-selected={id === activeId}
              className={`tab ${id === activeId ? 'is-on' : ''} ${dragIdx === i ? 'is-drag' : ''}`}
              title={`${noteTitle(n)}${i < 9 ? `  (Alt ${i + 1})` : ''}`}
              draggable
              onDragStart={(e) => {
                setDragIdx(i);
                e.dataTransfer.setData(DRAG_NOTE, JSON.stringify([id]));
                e.dataTransfer.setData('text/x-tab', String(i));
              }}
              onDragEnd={() => setDragIdx(null)}
              onDragOver={(e) => e.dataTransfer.types.includes('text/x-tab') && e.preventDefault()}
              onDrop={(e) => {
                const from = Number(e.dataTransfer.getData('text/x-tab'));
                if (Number.isNaN(from) || from === i) return;
                e.preventDefault();
                const next = [...tabs];
                const [m] = next.splice(from, 1);
                next.splice(i, 0, m);
                setState({ tabs: next });
              }}
              onClick={() => openNote(id)}
              onAuxClick={(e) => e.button === 1 && closeTab(id)}
              onContextMenu={(e) => {
                e.preventDefault();
                openMenu({ x: e.clientX, y: e.clientY }, [
                  { label: 'Close', hint: 'Alt W', onClick: () => closeTab(id) },
                  { label: 'Close others', onClick: () => setState({ tabs: [id] }) },
                  { label: 'Close tabs to the right', onClick: () => setState({ tabs: tabs.slice(0, i + 1) }) },
                  'sep',
                  { label: n.pinned ? 'Unpin note' : 'Pin note', onClick: () => togglePin(id) },
                  { label: 'Move to Trash', danger: true, onClick: () => trashNote(id) },
                ]);
              }}
            >
              <Icon size={14} strokeWidth={1.75} className="tab-icon" />
              <span className="tab-title">{noteTitle(n)}</span>
              <button
                className="tab-x"
                aria-label="Close tab"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(id);
                }}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
        <IconBtn icon={Plus} label="New note" size={16} className="tab-new" onClick={(e) => openMenu(e.currentTarget, newNoteMenuItems())} />
      </div>
    </div>
  );
}
