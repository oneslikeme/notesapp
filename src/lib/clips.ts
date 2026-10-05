import { bumpRev, saveContent } from './actions';
import { db } from './db';
import { flush } from './saver';
import { getState, toast } from './store';
import type { Clip, ResearchDoc } from './types';
import { uid } from './util';

/** Add a clip to a research note, or append it as a quote to a page note. */
export async function sendClip(targetId: string, clip: Omit<Clip, 'id' | 'createdAt'>) {
  const meta = getState().notes[targetId];
  if (!meta) return;
  await flush(targetId);
  const c = await db.contents.get(targetId);
  if (!c) return;
  const doc = structuredClone(c.doc);
  const full: Clip = { ...clip, id: uid(), createdAt: Date.now() };
  if (meta.type === 'research') {
    (doc as ResearchDoc).clips.unshift(full);
  } else if (meta.type === 'page') {
    const blocks: any[] = [];
    if (clip.kind === 'quote' && clip.text) {
      const cite: any[] = [{ type: 'text', text: '— ' }];
      if (clip.noteId) cite.push({ type: 'wikiLink', attrs: { id: clip.noteId, title: clip.source || 'source' } });
      else if (clip.source) cite.push({ type: 'text', text: clip.source });
      if (clip.page) cite.push({ type: 'text', text: `, p. ${clip.page}` });
      blocks.push({ type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: clip.text }] }, { type: 'paragraph', content: cite }] });
    } else if (clip.kind === 'image' && clip.blobId) {
      blocks.push({ type: 'image', attrs: { blobId: clip.blobId, width: 100 } });
    } else if (clip.kind === 'link' && clip.url) {
      blocks.push({ type: 'paragraph', content: [{ type: 'text', text: clip.title || clip.url, marks: [{ type: 'link', attrs: { href: clip.url } }] }] });
    } else if (clip.text) blocks.push({ type: 'paragraph', content: [{ type: 'text', text: clip.text }] });
    doc.doc.content.push(...blocks);
  } else {
    toast('Quotes can be sent to page or research notes');
    return;
  }
  await saveContent(targetId, doc);
  bumpRev(targetId);
  toast(`Added to “${meta.title || 'Untitled'}”`);
}
