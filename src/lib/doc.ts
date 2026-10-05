/** Helpers that read note content without an editor instance. */
import type { CanvasDoc, NoteType, PdfDoc, ResearchDoc } from './types';
import { getState } from './store';

const BLOCK = new Set([
  'paragraph', 'heading', 'blockquote', 'codeBlock', 'listItem', 'taskItem', 'bulletList', 'orderedList', 'taskList',
  'horizontalRule', 'inkBlock', 'audio', 'image',
]);

export function tiptapText(node: any): string {
  if (!node) return '';
  const out: string[] = [];
  const walk = (n: any) => {
    if (n.type === 'text') out.push(n.text || '');
    else if (n.type === 'wikiLink') out.push(n.attrs?.title || '');
    else if (n.type === 'hardBreak') out.push('\n');
    if (n.content) n.content.forEach(walk);
    if (BLOCK.has(n.type)) out.push('\n');
  };
  walk(node);
  return out.join('').replace(/\n{3,}/g, '\n\n').trim();
}

export function tiptapLinks(node: any, acc = new Set<string>()): Set<string> {
  if (!node) return acc;
  if (node.type === 'wikiLink' && node.attrs?.id) acc.add(node.attrs.id);
  if (node.content) node.content.forEach((c: any) => tiptapLinks(c, acc));
  return acc;
}

/** Resolve [[Title]] references written as plain text (canvas, clips). */
export function titleLinks(text: string, acc = new Set<string>()) {
  const re = /\[\[([^\]\n]{1,200})\]\]/g;
  let m: RegExpExecArray | null;
  if (!text.includes('[[')) return acc;
  const byTitle = titleIndex();
  while ((m = re.exec(text))) {
    const id = byTitle.get(m[1].trim().toLowerCase());
    if (id) acc.add(id);
  }
  return acc;
}

export function titleIndex() {
  const map = new Map<string, string>();
  for (const n of Object.values(getState().notes)) {
    if (!n.trashedAt && n.title) map.set(n.title.trim().toLowerCase(), n.id);
  }
  return map;
}

export function collectBlobIds(v: any, acc = new Set<string>()): Set<string> {
  if (!v || typeof v !== 'object') return acc;
  if (Array.isArray(v)) {
    v.forEach((x) => collectBlobIds(x, acc));
    return acc;
  }
  for (const [k, val] of Object.entries(v)) {
    if (k === 'blobId' && typeof val === 'string') acc.add(val);
    else if (val && typeof val === 'object') collectBlobIds(val, acc);
  }
  return acc;
}

export interface Indexed {
  text: string;
  links: string[];
  pages?: string[];
}

export function indexContent(type: NoteType, doc: any): Indexed {
  if (!doc) return { text: '', links: [] };
  switch (type) {
    case 'page': {
      const links = tiptapLinks(doc.doc);
      const text = tiptapText(doc.doc);
      titleLinks(text, links);
      return { text, links: [...links] };
    }
    case 'research': {
      const d = doc as ResearchDoc;
      const links = tiptapLinks(d.doc);
      const parts = [d.question];
      for (const c of d.clips || []) {
        parts.push([c.title, c.url, c.text, c.source, c.comment].filter(Boolean).join(' — '));
        if (c.noteId) links.add(c.noteId);
        titleLinks(c.comment || '', links);
      }
      parts.push(tiptapText(d.doc));
      const text = parts.filter(Boolean).join('\n');
      titleLinks(text, links);
      return { text, links: [...links] };
    }
    case 'canvas': {
      const d = doc as CanvasDoc;
      const links = new Set<string>();
      const parts: string[] = [];
      for (const it of d.items || []) {
        if (it.type === 'text') parts.push(it.text);
        if (it.type === 'card') links.add(it.noteId);
      }
      const text = parts.join('\n');
      titleLinks(text, links);
      return { text, links: [...links] };
    }
    case 'pdf': {
      const d = doc as PdfDoc;
      const links = tiptapLinks(d.notes);
      const parts: string[] = [];
      for (const a of Object.values(d.ann || {})) {
        for (const h of a.highlights) parts.push([h.text, h.comment].filter(Boolean).join(' — '));
        for (const t of a.texts) parts.push(t.text);
      }
      parts.push(tiptapText(d.notes));
      const text = parts.filter(Boolean).join('\n');
      titleLinks(text, links);
      return { text, links: [...links] };
    }
  }
}

export function makeExcerpt(text: string) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 220);
}

export function wordCount(text: string) {
  const m = text.match(/\S+/g);
  return m ? m.length : 0;
}

export function emptyDoc(type: NoteType, text?: string): any {
  const para = text
    ? text.split(/\n/).map((line) => (line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' }))
    : [{ type: 'paragraph' }];
  switch (type) {
    case 'page':
      return { doc: { type: 'doc', content: para } };
    case 'research':
      return { question: '', clips: [], doc: { type: 'doc', content: para } } satisfies ResearchDoc;
    case 'canvas':
      return { items: [], view: { x: 0, y: 0, zoom: 1 }, bg: 'dots' } satisfies CanvasDoc;
    case 'pdf':
      return null;
  }
}
