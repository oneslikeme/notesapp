import { saveContent } from './actions';
import type { NoteMeta } from './types';

type Getter = () => { doc: any; extra?: Partial<NoteMeta> & { pages?: string[] }; quiet?: boolean };

const pending = new Map<string, { timer: any; get: Getter }>();

/** Debounced save; the getter is read at flush time so it always sees the latest state. */
export function scheduleSave(id: string, get: Getter, delay = 500) {
  const prev = pending.get(id);
  if (prev) clearTimeout(prev.timer);
  const timer = setTimeout(() => flush(id), delay);
  pending.set(id, { timer, get });
}

export async function flush(id: string) {
  const p = pending.get(id);
  if (!p) return;
  clearTimeout(p.timer);
  pending.delete(id);
  const { doc, extra, quiet } = p.get();
  await saveContent(id, doc, extra, quiet);
}

export function flushAll() {
  return Promise.all([...pending.keys()].map(flush));
}

export function hasPending() {
  return pending.size > 0;
}

window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushAll();
});
window.addEventListener('pagehide', () => flushAll());
window.addEventListener('beforeunload', (e) => {
  if (hasPending()) {
    flushAll();
    e.preventDefault();
  }
});
