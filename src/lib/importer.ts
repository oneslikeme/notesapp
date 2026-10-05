import { marked } from 'marked';
import { generateJSON } from '@tiptap/core';
import { putBlob } from './blobs';
import { createNote } from './actions';
import { db } from './db';
import { loadPdfData, pageText, renderThumb } from './pdf';
import { indexNote } from './search';
import { getState, setState, toast } from './store';
import type { PdfDoc } from './types';
import { schemaExtensions } from '../editors/page/schema';

export async function importPdf(file: File | Blob, name: string, opts: { notebookId?: string | null; open?: boolean; title?: string } = {}) {
  const t = toastProgress(`Importing ${name}…`);
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const doc = await loadPdfData(bytes.slice());
    const pages: PdfDoc['pages'] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const p = await doc.getPage(i);
      const vp = p.getViewport({ scale: 1 });
      pages.push({ key: `p${i}`, src: i, w: Math.round(vp.width * 100) / 100, h: Math.round(vp.height * 100) / 100 });
      p.cleanup();
    }
    let thumb: string | undefined;
    try {
      // Rendering waits on animation frames; never let a background tab stall the import.
      thumb = await Promise.race([renderThumb(doc, 1, 240), new Promise<undefined>((r) => setTimeout(() => r(undefined), 4000))]);
    } catch {}
    const blobId = await putBlob(new Blob([bytes], { type: 'application/pdf' }), name);
    let title = opts.title ?? name.replace(/\.pdf$/i, '');
    try {
      const meta = await doc.getMetadata();
      const metaTitle = (meta.info as any)?.Title;
      if (!opts.title && metaTitle && typeof metaTitle === 'string' && metaTitle.trim().length > 3 && !/^(untitled|microsoft word)/i.test(metaTitle)) title = metaTitle.trim();
    } catch {}
    const content: PdfDoc = { blobId, fileName: name, pages, ann: {}, notes: null, lastPage: 1, zoom: 1, bookmarks: [] };
    const meta = await createNote('pdf', { title, doc: content, thumb, notebookId: opts.notebookId, open: opts.open });
    t.done(`Imported “${title}” — ${doc.numPages} pages`);
    // Extract text in the background so search covers the PDF.
    extractText(meta.id, doc).finally(() => doc.loadingTask.destroy());
    return meta;
  } catch (e: any) {
    t.done(`Couldn't import ${name}: ${e?.message || e}`);
    return null;
  }
}

async function extractText(noteId: string, doc: Awaited<ReturnType<typeof loadPdfData>>) {
  const texts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    try {
      texts.push(await pageText(doc, i));
    } catch {
      texts.push('');
    }
    if (i % 20 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  await db.contents.update(noteId, { pages: texts });
  const meta = getState().notes[noteId];
  const c = await db.contents.get(noteId);
  if (meta && c) indexNote(meta, c.text, texts);
}

export function markdownToDoc(md: string) {
  const html = marked.parse(md, { async: false, gfm: true }) as string;
  // Turn [[Wiki Links]] into plain text; they still resolve by title.
  return { type: 'doc', ...generateJSON(html, schemaExtensions()) } as any;
}

export async function importTextFile(file: File, opts: { notebookId?: string | null; open?: boolean } = {}) {
  const text = await file.text();
  const isMd = /\.(md|markdown)$/i.test(file.name);
  const isHtml = /\.html?$/i.test(file.name);
  let doc: any;
  let title = file.name.replace(/\.(md|markdown|txt|html?)$/i, '');
  if (isHtml) doc = generateJSON(text, schemaExtensions());
  else if (isMd) {
    const fm = text.match(/^# (.+)\n/);
    if (fm) title = fm[1].trim();
    doc = markdownToDoc(fm ? text.slice(fm[0].length) : text);
  } else {
    doc = {
      type: 'doc',
      content: text.split(/\n/).map((l) => (l ? { type: 'paragraph', content: [{ type: 'text', text: l }] } : { type: 'paragraph' })),
    };
  }
  return createNote('page', { title, doc: { doc }, notebookId: opts.notebookId, open: opts.open });
}

export async function importImage(file: File, opts: { notebookId?: string | null; open?: boolean } = {}) {
  const blobId = await putBlob(file, file.name);
  const doc = { doc: { type: 'doc', content: [{ type: 'image', attrs: { blobId, alt: file.name, width: 100 } }, { type: 'paragraph' }] } };
  return createNote('page', { title: file.name.replace(/\.\w+$/, ''), doc, notebookId: opts.notebookId, open: opts.open });
}

/** Import any dropped / picked files. */
export async function importFiles(files: File[], opts: { notebookId?: string | null } = {}) {
  let last: any = null;
  const single = files.length === 1;
  for (const f of files) {
    if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) last = await importPdf(f, f.name, { ...opts, open: single });
    else if (/\.(md|markdown|txt|html?)$/i.test(f.name) || f.type.startsWith('text/')) last = await importTextFile(f, { ...opts, open: single });
    else if (f.type.startsWith('image/')) last = await importImage(f, { ...opts, open: single });
    else if (/\.inkwell(\.zip)?$|\.zip$/i.test(f.name)) {
      const { restoreBackup } = await import('./backup');
      await restoreBackup(f);
    } else toast(`Can't import ${f.name}`);
  }
  if (!single && files.length) toast(`Imported ${files.length} files`);
  return last;
}

function toastProgress(text: string) {
  const id = Date.now() + Math.random();
  setState((s) => ({ toasts: [...s.toasts, { id, text }] }));
  return {
    done(msg: string) {
      setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      toast(msg);
    },
  };
}

