import { db, kvGet, kvSet } from './db';
import { collectBlobIds, emptyDoc, indexContent, makeExcerpt, wordCount } from './doc';
import { navigate, paths, getRoute } from './router';
import { indexAll, indexNote, reindexMeta, removeFromIndex } from './search';
import { getState, setState, toast, useStore } from './store';
import type { NoteMeta, NoteType, Notebook, Settings, Version } from './types';
import { DEFAULT_SETTINGS } from './types';
import { uid } from './util';
import { deleteBlobs } from './blobs';

const DAY = 86400000;

/* ---------------- Boot ---------------- */

export async function boot() {
  const [notes, notebooks, settings, tabs, ink, sidebar] = await Promise.all([
    db.notes.toArray(),
    db.notebooks.toArray(),
    kvGet<Partial<Settings>>('settings', {}),
    kvGet<string[]>('tabs', []),
    kvGet('ink', getState().ink),
    kvGet('sidebar', true),
  ]);
  const noteMap = Object.fromEntries(notes.map((n) => [n.id, n]));
  setState({
    notes: noteMap,
    notebooks: Object.fromEntries(notebooks.map((n) => [n.id, n])),
    settings: { ...DEFAULT_SETTINGS, ...settings },
    tabs: tabs.filter((t) => noteMap[t] && !noteMap[t].trashedAt),
    ink,
    sidebar: window.innerWidth < 900 ? false : sidebar,
    ready: true,
  });
  persistPrefs();
  await housekeeping();
  setInterval(housekeeping, 5 * 60_000);
  setTimeout(() => indexAll(), 50);
  navigator.storage?.persist?.().catch(() => {});
  if (!notes.length) await seedWelcome();
}

function persistPrefs() {
  let prev = getState();
  useStore.subscribe((s) => {
    if (s.tabs !== prev.tabs) kvSet('tabs', s.tabs);
    if (s.settings !== prev.settings) kvSet('settings', s.settings);
    if (s.ink !== prev.ink) kvSet('ink', s.ink);
    if (s.sidebar !== prev.sidebar && window.innerWidth >= 900) kvSet('sidebar', s.sidebar);
    prev = s;
  });
}

/** Expire scratch notes and purge old trash. */
export async function housekeeping() {
  const now = Date.now();
  const notes = Object.values(getState().notes);
  let expired = 0;
  for (const n of notes) {
    if (n.scratch && n.expiresAt && n.expiresAt < now && !n.trashedAt) {
      await updateMeta(n.id, { trashedAt: now });
      closeTab(n.id);
      expired++;
    }
  }
  for (const n of notes) {
    if (n.trashedAt && now - n.trashedAt > 30 * DAY) await deleteForever(n.id, true);
  }
  if (expired) toast(`${expired} scratch note${expired > 1 ? 's' : ''} expired and moved to Trash`);
}

/* ---------------- Notes ---------------- */

export interface CreateOpts {
  title?: string;
  notebookId?: string | null;
  tags?: string[];
  scratch?: boolean;
  doc?: any;
  pages?: string[];
  thumb?: string;
  open?: boolean;
}

export async function createNote(type: NoteType, opts: CreateOpts = {}): Promise<NoteMeta> {
  const now = Date.now();
  const s = getState();
  const route = getRoute();
  const notebookId =
    opts.notebookId !== undefined ? opts.notebookId : route.name === 'notebook' && route.id && s.notebooks[route.id] ? route.id : null;
  const doc = opts.doc ?? emptyDoc(type);
  const idx = indexContent(type, doc);
  const meta: NoteMeta = {
    id: uid(),
    type,
    title: opts.title ?? '',
    notebookId: opts.scratch ? null : notebookId,
    tags: opts.tags ?? (route.name === 'tag' && route.id ? [route.id] : []),
    pinned: false,
    createdAt: now,
    updatedAt: now,
    openedAt: now,
    trashedAt: null,
    scratch: !!opts.scratch,
    expiresAt: opts.scratch ? now + s.settings.scratchDays * DAY : null,
    excerpt: makeExcerpt(idx.text),
    words: wordCount(idx.text),
    links: idx.links,
    thumb: opts.thumb,
  };
  await db.transaction('rw', db.notes, db.contents, async () => {
    await db.notes.put(meta);
    await db.contents.put({ id: meta.id, doc, text: idx.text, pages: opts.pages });
  });
  setState((st) => ({ notes: { ...st.notes, [meta.id]: meta } }));
  indexNote(meta, idx.text, opts.pages);
  if (opts.open !== false) openNote(meta.id);
  return meta;
}

export async function loadContent(id: string) {
  return db.contents.get(id);
}

const lastVersionAt = new Map<string, number>();

async function latestVersionTime(id: string) {
  if (lastVersionAt.has(id)) return lastVersionAt.get(id)!;
  const last = await db.versions.where('[noteId+createdAt]').between([id, 0], [id, Infinity]).last();
  const t = last?.createdAt ?? 0;
  lastVersionAt.set(id, t);
  return t;
}

/** `quiet` persists view-only state (scroll, zoom, pan) without counting as an edit. */
export async function saveContent(id: string, doc: any, extra: Partial<NoteMeta> & { pages?: string[] } = {}, quiet = false) {
  const meta = getState().notes[id];
  if (!meta) return;
  const { pages, ...metaExtra } = extra;
  const idx = indexContent(meta.type, doc);
  const now = Date.now();
  const patch: Partial<NoteMeta> = {
    ...metaExtra,
    ...(quiet ? {} : { updatedAt: now }),
    excerpt: makeExcerpt(idx.text),
    words: wordCount(idx.text),
    links: idx.links,
  };
  const prevPages = pages ?? (await db.contents.get(id))?.pages;
  await db.transaction('rw', db.notes, db.contents, async () => {
    await db.contents.put({ id, doc, text: idx.text, pages: prevPages });
    await db.notes.update(id, patch);
  });
  const next = mergeMeta(id, patch);
  if (!next) return;
  indexNote(next, idx.text, prevPages);

  const minutes = getState().settings.versionMinutes;
  if (!quiet && now - (await latestVersionTime(id)) > minutes * 60_000) await snapshot(id, doc, idx.text);
}

/** Merge into the latest store value (not a snapshot taken before an await), skipping notes deleted meanwhile. */
function mergeMeta(id: string, patch: Partial<NoteMeta>): NoteMeta | null {
  const cur = getState().notes[id];
  if (!cur) return null;
  const next = { ...cur, ...patch };
  setState((s) => (s.notes[id] ? { notes: { ...s.notes, [id]: next } } : {}));
  return next;
}

export async function updateMeta(id: string, patch: Partial<NoteMeta>, touch = false) {
  const meta = getState().notes[id];
  if (!meta) return;
  const full = touch ? { ...patch, updatedAt: Date.now() } : patch;
  await db.notes.update(id, full);
  const next = mergeMeta(id, full);
  if (next && ('title' in patch || 'tags' in patch)) reindexMeta(next);
}

export function openNote(id: string, opts: { page?: number; replaceTab?: boolean } = {}) {
  const s = getState();
  if (!s.notes[id]) return;
  if (!s.tabs.includes(id)) {
    const route = getRoute();
    const cur = route.name === 'note' ? s.tabs.indexOf(route.id!) : -1;
    const tabs = [...s.tabs];
    if (opts.replaceTab && cur >= 0) tabs[cur] = id;
    else tabs.splice(cur >= 0 ? cur + 1 : tabs.length, 0, id);
    setState({ tabs: tabs.slice(-24) });
  }
  const now = Date.now();
  db.notes.update(id, { openedAt: now });
  setState((st) => ({ notes: { ...st.notes, [id]: { ...st.notes[id], openedAt: now } } }));
  navigate(paths.note(id, opts.page));
}

export function closeTab(id: string) {
  const s = getState();
  const i = s.tabs.indexOf(id);
  if (i < 0) return;
  const tabs = s.tabs.filter((t) => t !== id);
  setState({ tabs });
  const route = getRoute();
  if (route.name === 'note' && route.id === id) {
    const next = tabs[Math.min(i, tabs.length - 1)];
    navigate(next ? paths.note(next) : paths.home(), true);
  }
}

export async function trashNote(id: string) {
  await updateMeta(id, { trashedAt: Date.now() });
  closeTab(id);
  toast('Moved to Trash', { label: 'Undo', run: () => restoreNote(id) });
}

export async function restoreNote(id: string) {
  const n = getState().notes[id];
  if (!n) return;
  const patch: Partial<NoteMeta> = { trashedAt: null };
  if (n.scratch && n.expiresAt && n.expiresAt < Date.now()) patch.expiresAt = Date.now() + getState().settings.scratchDays * DAY;
  await updateMeta(id, patch);
}

export async function deleteForever(id: string, silent = false) {
  const content = await db.contents.get(id);
  const versions = await db.versions.where('noteId').equals(id).toArray();
  const blobIds = collectBlobIds(content?.doc);
  versions.forEach((v) => collectBlobIds(v.doc, blobIds));
  // Keep blobs that another note still references (e.g. duplicated notes).
  if (blobIds.size) {
    await db.contents.each((c) => {
      if (c.id === id) return;
      for (const b of collectBlobIds(c.doc)) blobIds.delete(b);
    });
    // ...including older versions of other notes, which can still be restored.
    await db.versions.each((v) => {
      if (v.noteId !== id) for (const b of collectBlobIds(v.doc)) blobIds.delete(b);
    });
  }
  await db.transaction('rw', [db.notes, db.contents, db.versions, db.blobs], async () => {
    await db.notes.delete(id);
    await db.contents.delete(id);
    await db.versions.where('noteId').equals(id).delete();
  });
  await deleteBlobs(blobIds);
  removeFromIndex(id);
  setState((s) => {
    const notes = { ...s.notes };
    delete notes[id];
    return { notes, tabs: s.tabs.filter((t) => t !== id) };
  });
  if (!silent) toast('Deleted permanently');
}

export async function emptyTrash() {
  const ids = Object.values(getState().notes).filter((n) => n.trashedAt).map((n) => n.id);
  for (const id of ids) await deleteForever(id, true);
  toast(`Deleted ${ids.length} note${ids.length === 1 ? '' : 's'}`);
}

export async function duplicateNote(id: string) {
  const meta = getState().notes[id];
  const content = await db.contents.get(id);
  if (!meta || !content) return;
  return createNote(meta.type, {
    title: meta.title ? `${meta.title} (copy)` : '',
    notebookId: meta.notebookId,
    tags: meta.tags,
    doc: structuredClone(content.doc),
    pages: content.pages,
    thumb: meta.thumb,
  });
}

export async function keepScratch(id: string) {
  await updateMeta(id, { scratch: false, expiresAt: null });
  toast('Kept — this note no longer expires');
}

export async function extendScratch(id: string, days: number) {
  await updateMeta(id, { expiresAt: Date.now() + days * DAY });
}

export async function togglePin(id: string) {
  const n = getState().notes[id];
  if (n) await updateMeta(id, { pinned: !n.pinned });
}

export async function moveNotes(ids: string[], notebookId: string | null) {
  for (const id of ids) {
    const n = getState().notes[id];
    await updateMeta(id, { notebookId, ...(n?.scratch ? { scratch: false, expiresAt: null } : {}) });
  }
  const nb = notebookId ? getState().notebooks[notebookId]?.name : 'Inbox';
  toast(`Moved ${ids.length > 1 ? `${ids.length} notes` : 'note'} to ${nb}`);
}

export async function addTags(ids: string[], tags: string[]) {
  for (const id of ids) {
    const n = getState().notes[id];
    if (n) await updateMeta(id, { tags: [...new Set([...n.tags, ...tags])] });
  }
}

/* ---------------- Notebooks ---------------- */

export async function createNotebook(name: string, parentId: string | null = null) {
  const nb: Notebook = { id: uid(), name: name.trim() || 'Untitled notebook', parentId, createdAt: Date.now(), order: Date.now() };
  await db.notebooks.put(nb);
  setState((s) => ({ notebooks: { ...s.notebooks, [nb.id]: nb } }));
  return nb;
}

export async function updateNotebook(id: string, patch: Partial<Notebook>) {
  await db.notebooks.update(id, patch);
  setState((s) => ({ notebooks: { ...s.notebooks, [id]: { ...s.notebooks[id], ...patch } } }));
}

export async function deleteNotebook(id: string) {
  const s = getState();
  const nb = s.notebooks[id];
  if (!nb) return;
  // Children and notes move up one level.
  for (const child of Object.values(s.notebooks).filter((n) => n.parentId === id)) await updateNotebook(child.id, { parentId: nb.parentId });
  for (const n of Object.values(s.notes).filter((n) => n.notebookId === id)) await updateMeta(n.id, { notebookId: nb.parentId });
  await db.notebooks.delete(id);
  setState((st) => {
    const notebooks = { ...st.notebooks };
    delete notebooks[id];
    return { notebooks };
  });
}

export function notebookPath(id: string | null): Notebook[] {
  const out: Notebook[] = [];
  const nbs = getState().notebooks;
  let cur = id ? nbs[id] : undefined;
  let guard = 0;
  while (cur && guard++ < 20) {
    out.unshift(cur);
    cur = cur.parentId ? nbs[cur.parentId] : undefined;
  }
  return out;
}

export function descendantNotebooks(id: string): Set<string> {
  const nbs = Object.values(getState().notebooks);
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of nbs) if (n.parentId && out.has(n.parentId) && !out.has(n.id)) (out.add(n.id), (grew = true));
  }
  return out;
}

/* ---------------- Versions ---------------- */

export async function snapshot(id: string, doc?: any, text?: string, label?: string) {
  const meta = getState().notes[id];
  if (!meta) return;
  if (doc === undefined) {
    const c = await db.contents.get(id);
    if (!c) return;
    doc = c.doc;
    text = c.text;
  }
  const v: Version = { id: uid(), noteId: id, createdAt: Date.now(), title: meta.title, doc: structuredClone(doc), text: text ?? '', label };
  await db.versions.put(v);
  lastVersionAt.set(id, v.createdAt);
  const all = await db.versions.where('noteId').equals(id).sortBy('createdAt');
  const unlabeled = all.filter((x) => !x.label);
  if (unlabeled.length > 150) await db.versions.bulkDelete(unlabeled.slice(0, unlabeled.length - 150).map((x) => x.id));
  return v;
}

export async function listVersions(id: string) {
  const all = await db.versions.where('noteId').equals(id).sortBy('createdAt');
  return all.reverse();
}

export async function restoreVersion(v: Version) {
  await snapshot(v.noteId, undefined, undefined, 'Before restore');
  await saveContent(v.noteId, structuredClone(v.doc));
  if (v.title !== getState().notes[v.noteId]?.title) await updateMeta(v.noteId, { title: v.title });
  bumpRev(v.noteId);
  toast('Version restored');
}

export function bumpRev(id: string) {
  setState((s) => ({ contentRev: { ...s.contentRev, [id]: (s.contentRev[id] || 0) + 1 } }));
}

/* ---------------- Settings ---------------- */

export function setSettings(patch: Partial<Settings>) {
  setState((s) => ({ settings: { ...s.settings, ...patch } }));
}

/* ---------------- Capture helpers ---------------- */

export async function appendToNote(id: string, text: string) {
  const meta = getState().notes[id];
  const c = await db.contents.get(id);
  if (!meta || !c) return;
  const stamp = new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  const paras = [
    { type: 'paragraph', content: [{ type: 'text', text: stamp, marks: [{ type: 'italic' }] }] },
    ...text.split('\n').map((l) => (l ? { type: 'paragraph', content: [{ type: 'text', text: l }] } : { type: 'paragraph' })),
  ];
  const doc = structuredClone(c.doc);
  if (meta.type === 'page') doc.doc.content.push(...paras);
  else if (meta.type === 'research') doc.clips.unshift({ id: uid(), kind: 'note', createdAt: Date.now(), text });
  else if (meta.type === 'canvas') {
    const maxY = Math.max(0, ...doc.items.map((i: any) => ('y' in i ? i.y + 60 : 0)));
    doc.items.push({ type: 'text', id: uid(), x: 0, y: maxY + 40, w: 320, text, size: 18, bg: 'yellow' });
  } else return;
  await saveContent(id, doc);
  bumpRev(id);
}

async function seedWelcome() {
  const p = (text: string, marks?: any[]) => ({ type: 'paragraph', content: [{ type: 'text', text, ...(marks ? { marks } : {}) }] });
  const h = (level: number, text: string) => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] });
  const li = (text: string) => ({ type: 'listItem', content: [p(text)] });
  const doc = {
    doc: {
      type: 'doc',
      content: [
        p('Inkwell keeps everything on this device — nothing is uploaded, and there is no AI anywhere in it.'),
        h(2, 'Getting around'),
        {
          type: 'bulletList',
          content: [
            li('Ctrl/⌘ K — jump to any note, or type > for commands'),
            li('Ctrl/⌘ Shift F — search everything, including PDF text'),
            li('Alt Q — Quick Capture from anywhere'),
            li('Alt N — new page note · Alt 1–9 — switch tabs'),
            li('Type / in a page for blocks: handwriting, audio, images, to-dos…'),
            li('Type [[ to link to another note. Backlinks appear in the info panel (Ctrl/⌘ .)'),
          ],
        },
        h(2, 'Note types'),
        {
          type: 'bulletList',
          content: [
            li('Page — writing with handwriting blocks, audio and images mixed in'),
            li('Canvas — an infinite surface for ink, text, sticky notes and images'),
            li('Research — collect links, quotes, screenshots and PDFs beside your own notes'),
            li('PDF — import, then highlight, write and draw directly on pages'),
            li('Scratch — throwaway notes that expire unless you keep them'),
          ],
        },
        {
          type: 'taskList',
          content: [
            { type: 'taskItem', attrs: { checked: true }, content: [p('Open Inkwell')] },
            { type: 'taskItem', attrs: { checked: false }, content: [p('Create a notebook from the sidebar')] },
            { type: 'taskItem', attrs: { checked: false }, content: [p('Import a PDF and write on it')] },
          ],
        },
      ],
    },
  };
  await createNote('page', { title: 'Welcome to Inkwell', doc, open: false });
}
