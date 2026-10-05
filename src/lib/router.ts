import { useSyncExternalStore } from 'react';

export interface Route {
  name: 'home' | 'note' | 'search' | 'notebook' | 'inbox' | 'all' | 'tag' | 'pinned' | 'scratch' | 'trash' | 'settings';
  id?: string;
  query: URLSearchParams;
}

function parse(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  const query = new URLSearchParams(qs || '');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const [head, id] = parts;
  switch (head) {
    case 'note':
    case 'notebook':
    case 'tag':
      return { name: head, id, query };
    case 'search':
    case 'inbox':
    case 'all':
    case 'pinned':
    case 'scratch':
    case 'trash':
    case 'settings':
      return { name: head, query };
    default:
      return { name: 'home', query };
  }
}

let current = parse(location.hash);
const listeners = new Set<() => void>();
window.addEventListener('hashchange', () => {
  current = parse(location.hash);
  listeners.forEach((l) => l());
});

export function useRoute() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

export function getRoute() {
  return current;
}

export function navigate(path: string, replace = false) {
  const hash = '#' + path;
  if (location.hash === hash) return;
  if (replace) {
    history.replaceState(null, '', hash);
    current = parse(hash);
    listeners.forEach((l) => l());
  } else {
    location.hash = path;
  }
}

export const paths = {
  home: () => '/',
  note: (id: string, page?: number) => `/note/${id}${page ? `?page=${page}` : ''}`,
  search: (q = '') => `/search${q ? `?q=${encodeURIComponent(q)}` : ''}`,
  notebook: (id: string) => `/notebook/${id}`,
  tag: (t: string) => `/tag/${encodeURIComponent(t)}`,
};
