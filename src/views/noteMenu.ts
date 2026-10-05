import { Copy, ExternalLink, FolderInput, Pin, PinOff, Save, Trash, RotateCcw, X } from 'lucide-react';
import type { NoteMeta } from '../lib/types';
import { openMenu } from '../components/ui';
import { deleteForever, duplicateNote, keepScratch, moveNotes, openNote, restoreNote, togglePin, trashNote } from '../lib/actions';
import { pickNotebook } from '../components/pickers';
import { confirmDialog } from '../components/ui';

export function noteMenu(e: React.MouseEvent, n: NoteMeta) {
  e.preventDefault();
  if (n.trashedAt) {
    openMenu({ x: e.clientX, y: e.clientY }, [
      { label: 'Restore', icon: RotateCcw, onClick: () => restoreNote(n.id) },
      { label: 'Delete forever', icon: X, danger: true, onClick: async () => (await confirmDialog({ title: 'Delete forever?', body: 'This cannot be undone.', confirm: 'Delete', danger: true })) && deleteForever(n.id) },
    ]);
    return;
  }
  openMenu({ x: e.clientX, y: e.clientY }, [
    { label: 'Open', icon: ExternalLink, onClick: () => openNote(n.id) },
    { label: n.pinned ? 'Unpin' : 'Pin', icon: n.pinned ? PinOff : Pin, onClick: () => togglePin(n.id) },
    { label: 'Move to…', icon: FolderInput, onClick: async () => { const r = await pickNotebook(); if (r) moveNotes([n.id], r.id); } },
    { label: 'Duplicate', icon: Copy, onClick: () => duplicateNote(n.id) },
    ...(n.scratch ? [{ label: 'Keep (stop expiring)', icon: Save, onClick: () => keepScratch(n.id) }] : []),
    'sep',
    { label: 'Move to Trash', icon: Trash, danger: true, onClick: () => trashNote(n.id) },
  ]);
}
