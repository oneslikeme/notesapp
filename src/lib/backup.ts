import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { db } from './db';
import { getState, toast } from './store';
import { makeCtx, noteToMarkdown } from './export';
import { notebookPath } from './actions';
import { downloadBlob, safeFileName } from './util';
import type { PdfDoc } from './types';

const stamp = () => new Date().toISOString().slice(0, 10);

/** Everything as Markdown in notebook folders, with attachments. */
export async function exportLibraryMarkdown() {
  const files: Record<string, Uint8Array> = {};
  const used = new Set<string>();
  const notes = Object.values(getState().notes).filter((n) => !n.trashedAt);
  for (const meta of notes) {
    const c = await db.contents.get(meta.id);
    if (!c) continue;
    const folder = meta.scratch ? 'Scratch' : notebookPath(meta.notebookId).map((n) => safeFileName(n.name)).join('/') || 'Inbox';
    let base = `${folder}/${safeFileName(meta.title)}`;
    for (let i = 2; used.has(base.toLowerCase()); i++) base = `${folder}/${safeFileName(meta.title)} ${i}`;
    used.add(base.toLowerCase());
    const ctx = await makeCtx('files', c.doc);
    const md = await noteToMarkdown(meta, c.doc, ctx);
    files[`${base}.md`] = strToU8(md);
    for (const f of ctx.files.values()) files[`${folder}/${f.name}`] = f.blob ? new Uint8Array(await f.blob.arrayBuffer()) : strToU8(f.text || '');
    if (meta.type === 'pdf') {
      const b = (await db.blobs.get((c.doc as PdfDoc).blobId))?.blob;
      if (b) files[`${base}.pdf`] = new Uint8Array(await b.arrayBuffer());
    }
  }
  downloadBlob(new Blob([zipSync(files, { level: 6 }) as BlobPart]), `Inkwell notes ${stamp()}.zip`);
  toast(`Exported ${notes.length} notes as Markdown`);
}

/** Lossless backup that can be restored into Inkwell. */
export async function exportBackup() {
  const [notes, contents, notebooks, versions, blobs, kv] = await Promise.all([
    db.notes.toArray(), db.contents.toArray(), db.notebooks.toArray(), db.versions.toArray(), db.blobs.toArray(), db.kv.toArray(),
  ]);
  const files: Record<string, Uint8Array> = {};
  const blobIndex = blobs.map(({ blob, ...rest }) => rest);
  for (const b of blobs) files[`blobs/${b.id}`] = new Uint8Array(await b.blob.arrayBuffer());
  files['inkwell.json'] = strToU8(JSON.stringify({ format: 'inkwell-backup', version: 1, createdAt: Date.now(), notes, contents, notebooks, versions, kv, blobs: blobIndex }));
  downloadBlob(new Blob([zipSync(files, { level: 1 }) as BlobPart]), `Inkwell backup ${stamp()}.inkwell.zip`);
  toast('Backup downloaded');
}

export async function restoreBackup(file: File) {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (file.name.endsWith('.json')) return await restoreSingleNote(JSON.parse(strFromU8(bytes)));
    const z = unzipSync(bytes);
    if (!z['inkwell.json']) throw new Error('Not an Inkwell backup');
    const data = JSON.parse(strFromU8(z['inkwell.json']));
    await db.transaction('rw', [db.notes, db.contents, db.notebooks, db.versions, db.blobs], async () => {
      await db.notes.bulkPut(data.notes);
      await db.contents.bulkPut(data.contents);
      await db.notebooks.bulkPut(data.notebooks);
      await db.versions.bulkPut(data.versions);
      for (const b of data.blobs) {
        const raw = z[`blobs/${b.id}`];
        if (raw) await db.blobs.put({ ...b, blob: new Blob([raw as BlobPart], { type: b.mime }) });
      }
    });
    toast(`Restored ${data.notes.length} notes — reloading…`);
    setTimeout(() => location.reload(), 900);
  } catch (e: any) {
    toast(`Restore failed: ${e?.message || e}`);
  }
}

async function restoreSingleNote(data: any) {
  if (data?.inkwell !== 1 || !data.meta) throw new Error('Not an Inkwell note file');
  for (const [id, b] of Object.entries<any>(data.blobs || {})) {
    const blob = await (await fetch(b.data)).blob();
    await db.blobs.put({ id, blob, name: b.name, mime: b.mime, size: blob.size, createdAt: Date.now() });
  }
  const { createNote } = await import('./actions');
  await createNote(data.meta.type, { title: data.meta.title, tags: data.meta.tags, doc: data.content.doc, pages: data.content.pages, thumb: data.meta.thumb });
}
