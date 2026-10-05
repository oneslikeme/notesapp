/** Tracks what changed locally since the last successful sync. Persisted so nothing is forgotten across reloads. */
import { kvGet, kvSet } from '../db';

const dirtyNotes = new Set<string>();
const deletedNotes = new Map<string, number>();
const notebookTombs = new Map<string, number>();
let notebooksDirty = false;
let loaded = false;
let persistTimer: any;
const listeners = new Set<() => void>();

export async function loadChanges() {
  const saved = await kvGet<{ notes: string[]; deleted: [string, number][]; nbTombs: [string, number][]; nb: boolean } | null>('sync.changes', null);
  if (saved) {
    saved.notes.forEach((id) => dirtyNotes.add(id));
    saved.deleted.forEach(([id, at]) => deletedNotes.set(id, at));
    saved.nbTombs.forEach(([id, at]) => notebookTombs.set(id, at));
    notebooksDirty = saved.nb;
  }
  loaded = true;
}

function persist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    kvSet('sync.changes', { notes: [...dirtyNotes], deleted: [...deletedNotes], nbTombs: [...notebookTombs], nb: notebooksDirty });
  }, 200);
  listeners.forEach((l) => l());
}

export function onLocalChange(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function markNote(id: string) {
  dirtyNotes.add(id);
  deletedNotes.delete(id);
  persist();
}

export function markNoteDeleted(id: string) {
  dirtyNotes.delete(id);
  deletedNotes.set(id, Date.now());
  persist();
}

export function markNotebooks(deletedId?: string) {
  notebooksDirty = true;
  if (deletedId) notebookTombs.set(deletedId, Date.now());
  persist();
}

export function pendingChanges() {
  return { notes: [...dirtyNotes], deleted: [...deletedNotes], notebooks: notebooksDirty, nbTombs: notebookTombs };
}

export function isNoteDirty(id: string) {
  return dirtyNotes.has(id);
}

export function clearNote(id: string) {
  dirtyNotes.delete(id);
  deletedNotes.delete(id);
  persist();
}

export function clearNotebooks() {
  notebooksDirty = false;
  persist();
}

export function changeCount() {
  return dirtyNotes.size + deletedNotes.size + (notebooksDirty ? 1 : 0);
}

export function changesLoaded() {
  return loaded;
}
