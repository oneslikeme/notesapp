import Dexie, { type Table } from 'dexie';
import type { BlobRec, NoteContent, NoteMeta, Notebook, Version } from './types';

class InkwellDB extends Dexie {
  notes!: Table<NoteMeta, string>;
  contents!: Table<NoteContent, string>;
  notebooks!: Table<Notebook, string>;
  blobs!: Table<BlobRec, string>;
  versions!: Table<Version, string>;
  kv!: Table<{ key: string; value: any }, string>;

  constructor() {
    super('inkwell');
    this.version(1).stores({
      notes: 'id, type, notebookId, updatedAt, openedAt, trashedAt, *tags, *links',
      contents: 'id',
      notebooks: 'id, parentId',
      blobs: 'id',
      versions: 'id, noteId, createdAt, [noteId+createdAt]',
      kv: 'key',
    });
  }
}

export const db = new InkwellDB();

export async function kvGet<T>(key: string, fallback: T): Promise<T> {
  const row = await db.kv.get(key);
  return row ? (row.value as T) : fallback;
}
export function kvSet(key: string, value: any) {
  return db.kv.put({ key, value });
}
