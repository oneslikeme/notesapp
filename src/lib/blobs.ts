import { db } from './db';
import { uid } from './util';

const urlCache = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();

export async function putBlob(blob: Blob, name = 'file'): Promise<string> {
  const id = uid();
  await db.blobs.put({ id, blob, name, mime: blob.type, size: blob.size, createdAt: Date.now() });
  urlCache.set(id, URL.createObjectURL(blob));
  return id;
}

export async function getBlob(id: string) {
  return (await db.blobs.get(id))?.blob ?? null;
}

export function blobUrlSync(id: string) {
  return urlCache.get(id) ?? null;
}

export function blobUrl(id: string): Promise<string | null> {
  const hit = urlCache.get(id);
  if (hit) return Promise.resolve(hit);
  let p = pending.get(id);
  if (!p) {
    p = db.blobs.get(id).then((r) => {
      pending.delete(id);
      if (!r) return null;
      const u = URL.createObjectURL(r.blob);
      urlCache.set(id, u);
      return u;
    });
    pending.set(id, p);
  }
  return p;
}

export async function deleteBlobs(ids: Iterable<string>) {
  const list = [...ids];
  for (const id of list) {
    const u = urlCache.get(id);
    if (u) URL.revokeObjectURL(u);
    urlCache.delete(id);
  }
  await db.blobs.bulkDelete(list);
}
