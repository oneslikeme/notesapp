/**
 * OneDrive sync. Layout inside OneDrive/Apps/Inkwell:
 *   notes/<id>.json     { v, meta, content, blobs } or { v, deleted, id, at } (tombstone)
 *   blobs/<blobId>      PDFs, audio, images (immutable, uploaded once)
 *   notebooks.json      { v, notebooks, tombstones }
 *
 * Each sync: pull changed notes (by eTag), push local changes (with If-Match so a
 * concurrent edit is never silently overwritten), then merge notebooks.
 * If both sides changed a note, the remote version wins the original note and the
 * local version is kept as a "(conflicted copy)" — nothing is ever lost.
 */
import { create } from 'zustand';
import { db, kvGet, kvSet } from '../db';
import { getState, setState, toast } from '../store';
import { bumpRev, createNote, deleteForever } from '../actions';
import { indexNote } from '../search';
import { collectBlobIds, indexContent } from '../doc';
import { flushAll, hasPendingFor } from '../saver';
import type { NoteContent, NoteMeta, Notebook } from '../types';
import * as od from './onedrive';
import { changeCount, clearNote, clearNotebooks, isNoteDirty, loadChanges, markNote, markNotebooks, onLocalChange, pendingChanges } from './changes';

export type SyncStatus = 'unconfigured' | 'off' | 'idle' | 'syncing' | 'error' | 'reconnect' | 'offline';

interface SyncUI {
  status: SyncStatus;
  lastSync: number | null;
  error: string | null;
  account: string | null;
  progress: string | null;
  pending: number;
}

export const useSync = create<SyncUI>(() => ({ status: 'unconfigured', lastSync: null, error: null, account: null, progress: null, pending: 0 }));

interface SyncState {
  etags: Record<string, string>;
  blobs: string[];
  nbEtag: string | null;
  lastSync: number | null;
  initialized: boolean;
}

const EMPTY: SyncState = { etags: {}, blobs: [], nbEtag: null, lastSync: null, initialized: false };
let state: SyncState = EMPTY;
let running: Promise<void> | null = null;
let again = false;
let timer: any;
let started = false;

/* ---------------- lifecycle ---------------- */

export async function startSync() {
  if (started) return;
  started = true;
  await loadChanges();
  state = { ...EMPTY, ...(await kvGet<SyncState | null>('sync.state', null)) };
  useSync.setState({ lastSync: state.lastSync, pending: changeCount() });
  onLocalChange(() => {
    useSync.setState({ pending: changeCount() });
    requestSync(5000);
  });

  if (!od.clientId()) return useSync.setState({ status: 'unconfigured' });
  let auth: Awaited<ReturnType<typeof od.initAuth>>;
  try {
    auth = await od.initAuth();
  } catch (e: any) {
    return useSync.setState({ status: 'error', error: e?.message || String(e) });
  }
  if (!auth.account) return useSync.setState({ status: 'off' });
  useSync.setState({ status: 'idle', account: auth.account.username });
  if (auth.justSignedIn) toast(`Connected to OneDrive as ${auth.account.username}`);

  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && requestSync(300));
  window.addEventListener('online', () => requestSync(300));
  setInterval(() => document.visibilityState === 'visible' && requestSync(0), 90_000);
  requestSync(500);
}

export function requestSync(delay = 4000) {
  const s = useSync.getState().status;
  if (s === 'unconfigured' || s === 'off' || s === 'reconnect') return;
  clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), delay);
}

export function syncNow(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        await runOnce();
      } while (again);
    } finally {
      running = null;
    }
  })();
  return running;
}

export async function connect() {
  await od.signIn();
}

export async function reconnect() {
  await od.reconnect();
}

export async function disconnect() {
  await od.signOut();
  state = { ...EMPTY };
  await kvSet('sync.state', state);
  useSync.setState({ status: 'off', account: null, lastSync: null, error: null });
  toast('Disconnected from OneDrive. Notes on this device are unchanged.');
}

/** After restoring a backup everything local must be re-uploaded. */
export async function resetSyncBaseline() {
  const s = { ...EMPTY, ...(await kvGet<SyncState | null>('sync.state', null)), initialized: false };
  await kvSet('sync.state', s);
}

/* ---------------- one sync round ---------------- */

async function runOnce() {
  if (!navigator.onLine) return useSync.setState({ status: 'offline' });
  useSync.setState({ status: 'syncing', error: null });
  try {
    await flushAll();
    if (!state.initialized) {
      // First sync on this device (or after a restore): everything local is new to the cloud.
      for (const id of Object.keys(getState().notes)) markNote(id);
      markNotebooks();
    }
    const [remoteNotes, remoteBlobs] = await Promise.all([od.listFolder('notes'), od.listFolder('blobs')]);
    const blobMap = new Map(remoteBlobs.map((b) => [b.name, b]));
    for (const b of remoteBlobs) if (!state.blobs.includes(b.name)) state.blobs.push(b.name);

    await pull(remoteNotes, blobMap);
    await push();
    await syncNotebooks();

    state.initialized = true;
    state.lastSync = Date.now();
    await kvSet('sync.state', state);
    useSync.setState({ status: 'idle', lastSync: state.lastSync, progress: null, pending: changeCount() });
  } catch (e: any) {
    await kvSet('sync.state', state);
    if (e instanceof od.ReconnectNeeded) return useSync.setState({ status: 'reconnect', progress: null, error: null });
    if (!navigator.onLine) return useSync.setState({ status: 'offline', progress: null });
    console.error('Sync failed', e);
    useSync.setState({ status: 'error', progress: null, error: e?.message || String(e) });
  }
}

/* ---------------- pull ---------------- */

async function pull(remote: od.RemoteItem[], blobMap: Map<string, od.RemoteItem>) {
  const seen = new Set<string>();
  const changed = remote.filter((r) => {
    if (!r.name.endsWith('.json')) return false;
    const id = r.name.slice(0, -5);
    seen.add(id);
    return state.etags[id] !== r.eTag;
  });
  // A file that vanished from OneDrive (deleted by hand) is simply re-uploaded.
  for (const id of Object.keys(state.etags)) {
    if (!seen.has(id)) {
      delete state.etags[id];
      if (getState().notes[id]) markNote(id);
    }
  }
  let i = 0;
  for (const item of changed) {
    useSync.setState({ progress: changed.length > 3 ? `Downloading ${++i} of ${changed.length}` : null });
    const id = item.name.slice(0, -5);
    const data = JSON.parse(await (await od.download(item)).text());
    if (data.deleted) {
      if (getState().notes[id]) await deleteForever(id, true, true);
      clearNote(id);
      state.etags[id] = item.eTag;
      continue;
    }
    await fetchBlobs(data, blobMap);
    const local = getState().notes[id];
    const knewIt = id in state.etags;
    if (local && (isNoteDirty(id) || hasPendingFor(id))) {
      await flushAll();
      const localContent = await db.contents.get(id);
      if (localContent && !sameContent(local, localContent, data.meta, data.content)) {
        if (knewIt || data.meta.updatedAt >= local.updatedAt) {
          await keepConflictCopy(local, localContent);
        } else {
          // First sync of a note both devices have, and ours is newer: keep ours, push it.
          state.etags[id] = item.eTag;
          continue;
        }
      }
    }
    await applyRemote(data.meta, data.content);
    clearNote(id);
    state.etags[id] = item.eTag;
  }
}

async function fetchBlobs(data: any, blobMap: Map<string, od.RemoteItem>) {
  for (const blobId of collectBlobIds(data.content?.doc)) {
    if (await db.blobs.get(blobId)) continue;
    const item = blobMap.get(blobId);
    if (!item) continue;
    const info = data.blobs?.[blobId] ?? {};
    const raw = await od.download(item);
    const blob = new Blob([raw], { type: info.mime || raw.type });
    await db.blobs.put({ id: blobId, blob, name: info.name || blobId, mime: blob.type, size: blob.size, createdAt: Date.now() });
  }
}

/** Ignore view-only state (scroll position, zoom, pan) when deciding whether two versions really differ. */
function sameContent(lm: NoteMeta, lc: NoteContent, rm: NoteMeta, rc: NoteContent) {
  const strip = (doc: any) => {
    if (!doc || typeof doc !== 'object') return doc;
    const { view, lastPage, zoom, ...rest } = doc;
    return rest;
  };
  return lm.title === rm.title && JSON.stringify(strip(lc.doc)) === JSON.stringify(strip(rc.doc));
}

async function keepConflictCopy(local: NoteMeta, content: NoteContent) {
  const device = /iPad|iPhone/.test(navigator.userAgent) ? 'iPad' : /Android/.test(navigator.userAgent) ? 'Android' : 'this device';
  await createNote(local.type, {
    title: `${local.title || 'Untitled'} (conflicted copy, ${device})`,
    notebookId: local.notebookId,
    tags: local.tags,
    doc: structuredClone(content.doc),
    pages: content.pages,
    thumb: local.thumb,
    open: false,
  });
  toast(`“${local.title || 'Untitled'}” was edited on two devices — kept both versions`);
}

async function applyRemote(meta: NoteMeta, content: NoteContent) {
  const local = getState().notes[meta.id];
  // Recompute derived text rather than trusting the file, so search always matches the document.
  content = { ...content, text: indexContent(meta.type, content.doc).text };
  const merged: NoteMeta = { ...meta, openedAt: local?.openedAt ?? meta.openedAt };
  await db.transaction('rw', db.notes, db.contents, async () => {
    await db.notes.put(merged);
    await db.contents.put(content);
  });
  setState((s) => ({ notes: { ...s.notes, [meta.id]: merged } }));
  indexNote(merged, content.text || '', content.pages);
  if (local) bumpRev(meta.id);
}

/* ---------------- push ---------------- */

async function push() {
  const { notes, deleted } = pendingChanges();
  let i = 0;
  const total = notes.length + deleted.length;
  for (const [id, at] of deleted) {
    useSync.setState({ progress: total > 3 ? `Uploading ${++i} of ${total}` : null });
    const blob = new Blob([JSON.stringify({ v: 1, deleted: true, id, at })], { type: 'application/json' });
    state.etags[id] = await od.upload(`notes/${id}.json`, blob);
    clearNote(id);
  }
  for (const id of notes) {
    useSync.setState({ progress: total > 3 ? `Uploading ${++i} of ${total}` : null });
    const meta = getState().notes[id];
    const content = await db.contents.get(id);
    if (!meta || !content) {
      clearNote(id);
      continue;
    }
    const blobs: Record<string, { name: string; mime: string }> = {};
    for (const blobId of collectBlobIds(content.doc)) {
      const rec = await db.blobs.get(blobId);
      if (!rec) continue;
      blobs[blobId] = { name: rec.name, mime: rec.mime };
      if (!state.blobs.includes(blobId)) {
        await od.upload(`blobs/${blobId}`, rec.blob);
        state.blobs.push(blobId);
      }
    }
    const payload = new Blob([JSON.stringify({ v: 1, meta, content, blobs })], { type: 'application/json' });
    try {
      state.etags[id] = await od.upload(`notes/${id}.json`, payload, state.etags[id]);
      clearNote(id);
    } catch (e) {
      // 412: changed on another device since we last looked — the next round pulls it and resolves.
      if (e instanceof od.GraphError && e.status === 412) {
        again = true;
        continue;
      }
      throw e;
    }
  }
}

/* ---------------- notebooks ---------------- */

async function syncNotebooks() {
  const { notebooks: localDirty, nbTombs } = pendingChanges();
  const item = await od.getItem('notebooks.json');
  // Nothing changed on either side.
  if (item && item.eTag === state.nbEtag && !localDirty) return;
  if (!item && !localDirty && !Object.keys(getState().notebooks).length) return;
  const remote: { notebooks: Notebook[]; tombstones: Record<string, number> } = item
    ? JSON.parse(await (await od.download(item)).text())
    : { notebooks: [], tombstones: {} };

  const local = getState().notebooks;
  const tombs: Record<string, number> = { ...remote.tombstones };
  for (const [id, at] of nbTombs) tombs[id] = Math.max(tombs[id] || 0, at);
  const stamp = (n: Notebook) => n.updatedAt ?? n.createdAt;
  const merged = new Map<string, Notebook>();
  for (const n of [...remote.notebooks, ...Object.values(local)]) {
    const cur = merged.get(n.id);
    if (!cur || stamp(n) > stamp(cur)) merged.set(n.id, n);
  }
  for (const [id, at] of Object.entries(tombs)) {
    const n = merged.get(id);
    if (n && at >= stamp(n)) merged.delete(id);
  }

  // Apply locally.
  const next = Object.fromEntries([...merged].map(([id, n]) => [id, n]));
  const removed = Object.keys(local).filter((id) => !next[id]);
  await db.transaction('rw', db.notebooks, async () => {
    await db.notebooks.bulkPut([...merged.values()]);
    if (removed.length) await db.notebooks.bulkDelete(removed);
  });
  setState({ notebooks: next });

  const remoteSame = item && JSON.stringify(remote.notebooks.map((n) => [n.id, stamp(n)]).sort()) === JSON.stringify([...merged.values()].map((n) => [n.id, stamp(n)]).sort());
  if (!remoteSame || localDirty) {
    const blob = new Blob([JSON.stringify({ v: 1, notebooks: [...merged.values()], tombstones: tombs })], { type: 'application/json' });
    try {
      state.nbEtag = await od.upload('notebooks.json', blob, item?.eTag);
    } catch (e) {
      if (e instanceof od.GraphError && e.status === 412) {
        again = true;
        return;
      }
      throw e;
    }
  } else state.nbEtag = item!.eTag;
  clearNotebooks();
}
