import MiniSearch from 'minisearch';
import { db } from './db';
import { getState, setState } from './store';
import type { NoteMeta, NoteType } from './types';

interface IdxDoc {
  id: string;
  noteId: string;
  page: number;
  title: string;
  text: string;
  tags: string;
}

const mini = new MiniSearch<IdxDoc>({
  fields: ['title', 'text', 'tags'],
  storeFields: ['noteId', 'page'],
  searchOptions: { boost: { title: 4, tags: 2 }, prefix: true, fuzzy: 0.15, combineWith: 'AND' },
});

/** docId -> text, kept for snippets. */
const texts = new Map<string, string>();
/** noteId -> docIds */
const byNote = new Map<string, string[]>();

function put(doc: IdxDoc) {
  if (mini.has(doc.id)) mini.discard(doc.id);
  mini.add(doc);
  texts.set(doc.id, doc.text);
}

export function indexNote(meta: NoteMeta, text: string, pages?: string[]) {
  removeFromIndex(meta.id);
  const ids: string[] = [];
  const tags = meta.tags.join(' ');
  put({ id: meta.id, noteId: meta.id, page: 0, title: meta.title || 'Untitled', text, tags });
  ids.push(meta.id);
  pages?.forEach((t, i) => {
    if (!t.trim()) return;
    const id = `${meta.id}::${i + 1}`;
    put({ id, noteId: meta.id, page: i + 1, title: '', text: t, tags: '' });
    ids.push(id);
  });
  byNote.set(meta.id, ids);
}

/** Title/tags changed: re-add the main doc using cached text. */
export function reindexMeta(meta: NoteMeta) {
  const text = texts.get(meta.id) ?? '';
  put({ id: meta.id, noteId: meta.id, page: 0, title: meta.title || 'Untitled', text, tags: meta.tags.join(' ') });
  if (!byNote.has(meta.id)) byNote.set(meta.id, [meta.id]);
}

export function removeFromIndex(noteId: string) {
  for (const id of byNote.get(noteId) || []) {
    if (mini.has(id)) mini.discard(id);
    texts.delete(id);
  }
  byNote.delete(noteId);
}

export async function indexAll() {
  setState({ indexing: true });
  const notes = getState().notes;
  // Titles first so search works immediately.
  for (const n of Object.values(notes)) reindexMeta(n);
  let batch = 0;
  await db.contents.each((c) => {
    const meta = getState().notes[c.id];
    if (meta) indexNote(meta, c.text || '', c.pages);
    batch++;
  });
  setState({ indexing: false });
  return batch;
}

/* ---------------- Query ---------------- */

export interface SearchFilters {
  types: NoteType[];
  tags: string[];
  notebooks: string[];
  pinned?: boolean;
  scratch?: boolean;
  trashed?: boolean;
  phrases: string[];
  text: string;
}

export function parseQuery(q: string): SearchFilters {
  const f: SearchFilters = { types: [], tags: [], notebooks: [], phrases: [], text: '' };
  const rest: string[] = [];
  const re = /(\w+):("[^"]*"|\S+)|"([^"]+)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q))) {
    if (m[1]) {
      const key = m[1].toLowerCase();
      const val = m[2].replace(/^"|"$/g, '');
      if (key === 'type') f.types.push(val.toLowerCase() as NoteType);
      else if (key === 'tag') f.tags.push(val.replace(/^#/, '').toLowerCase());
      else if (key === 'in') f.notebooks.push(val.toLowerCase());
      else if (key === 'is') {
        if (val === 'pinned') f.pinned = true;
        if (val === 'scratch') f.scratch = true;
        if (val === 'trashed' || val === 'trash') f.trashed = true;
      } else rest.push(m[0]);
    } else if (m[3]) {
      f.phrases.push(m[3]);
      rest.push(m[3]);
    } else if (m[4]) {
      if (m[4].startsWith('#') && m[4].length > 1) f.tags.push(m[4].slice(1).toLowerCase());
      else rest.push(m[4]);
    }
  }
  f.text = rest.join(' ');
  return f;
}

export interface Hit {
  noteId: string;
  score: number;
  page: number;
  terms: string[];
  snippet: { t: string; hit: boolean }[];
  more: number;
}

function matchesFilters(n: NoteMeta, f: SearchFilters) {
  if (!!n.trashedAt !== !!f.trashed) return false;
  if (f.types.length && !f.types.includes(n.type)) return false;
  if (f.pinned && !n.pinned) return false;
  if (f.scratch && !n.scratch) return false;
  if (f.tags.length) {
    const t = n.tags.map((x) => x.toLowerCase());
    if (!f.tags.every((x) => t.includes(x))) return false;
  }
  if (f.notebooks.length) {
    const nb = n.notebookId ? getState().notebooks[n.notebookId]?.name.toLowerCase() : 'inbox';
    if (!nb || !f.notebooks.some((x) => nb.includes(x))) return false;
  }
  return true;
}

export function search(q: string, limit = 60): Hit[] {
  const f = parseQuery(q);
  const notes = getState().notes;
  if (!f.text.trim()) {
    if (!f.types.length && !f.tags.length && !f.notebooks.length && !f.pinned && !f.scratch && !f.trashed) return [];
    return Object.values(notes)
      .filter((n) => matchesFilters(n, f))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit)
      .map((n) => ({ noteId: n.id, score: 0, page: 0, terms: [], snippet: [{ t: n.excerpt, hit: false }], more: 0 }));
  }
  const raw = mini.search(f.text);
  const grouped = new Map<string, Hit>();
  for (const r of raw) {
    const noteId = r.noteId as string;
    const meta = notes[noteId];
    if (!meta || !matchesFilters(meta, f)) continue;
    const text = texts.get(r.id) ?? '';
    if (f.phrases.length) {
      const lower = (meta.title + '\n' + text).toLowerCase();
      if (!f.phrases.every((p) => lower.includes(p.toLowerCase()))) continue;
    }
    const prev = grouped.get(noteId);
    if (prev) {
      prev.more++;
      prev.score += r.score * 0.15;
      continue;
    }
    // Small recency boost so fresh notes float up among similar matches.
    const ageDays = (Date.now() - meta.updatedAt) / 86400000;
    const boost = 1 + 0.25 / (1 + ageDays / 7) + (meta.pinned ? 0.1 : 0);
    grouped.set(noteId, {
      noteId,
      score: r.score * boost,
      page: r.page as number,
      terms: r.terms,
      snippet: makeSnippet(text, r.terms),
      more: 0,
    });
  }
  return [...grouped.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

export function makeSnippet(text: string, terms: string[], radius = 90) {
  if (!text) return [];
  const lower = text.toLowerCase();
  let at = -1;
  for (const t of terms) {
    const i = lower.indexOf(t.toLowerCase());
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  const start = Math.max(0, at < 0 ? 0 : at - radius);
  const end = Math.min(text.length, (at < 0 ? 0 : at) + radius * 1.6);
  let slice = text.slice(start, end).replace(/\s+/g, ' ');
  if (start > 0) slice = '…' + slice;
  if (end < text.length) slice += '…';
  return highlightTerms(slice, terms);
}

export function highlightTerms(s: string, terms: string[]) {
  if (!terms.length) return [{ t: s, hit: false }];
  const esc = terms.filter(Boolean).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!esc.length) return [{ t: s, hit: false }];
  const re = new RegExp(`(${esc.join('|')})`, 'gi');
  const whole = new RegExp(`^(${esc.join('|')})$`, 'i');
  return s
    .split(re)
    .filter(Boolean)
    .map((t) => ({ t, hit: whole.test(t) }));
}

export function titleSuggest(q: string, limit = 8, exclude?: string): NoteMeta[] {
  const notes = getState().notes;
  const s = q.trim().toLowerCase();
  const all = Object.values(notes).filter((n) => !n.trashedAt && n.id !== exclude);
  if (!s) return all.sort((a, b) => b.openedAt - a.openedAt).slice(0, limit);
  const scored: [NoteMeta, number][] = [];
  for (const n of all) {
    const t = (n.title || 'Untitled').toLowerCase();
    let score = 0;
    if (t === s) score = 100;
    else if (t.startsWith(s)) score = 60;
    else if (t.split(/\s+/).some((w) => w.startsWith(s))) score = 40;
    else if (t.includes(s)) score = 25;
    else if (fuzzy(t, s)) score = 10;
    if (score) scored.push([n, score + Math.min(5, (n.openedAt / 1e12) % 1)]);
  }
  return scored.sort((a, b) => b[1] - a[1] || b[0].openedAt - a[0].openedAt).slice(0, limit).map((x) => x[0]);
}

function fuzzy(hay: string, needle: string) {
  let i = 0;
  for (const c of hay) if (c === needle[i]) i++;
  return i === needle.length;
}

export function noteText(id: string) {
  return texts.get(id) ?? '';
}

export function allNoteTexts() {
  return texts;
}
