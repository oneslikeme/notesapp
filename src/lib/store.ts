import { create } from 'zustand';
import type { InkTool, NoteMeta, Notebook, Settings } from './types';
import { DEFAULT_SETTINGS } from './types';

export type Panel = null | 'info' | 'outline' | 'history';

export interface InkPrefs {
  tool: InkTool;
  pen: { color: string; size: number };
  hl: { color: string; size: number };
}

export interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

interface State {
  ready: boolean;
  notes: Record<string, NoteMeta>;
  notebooks: Record<string, Notebook>;
  tabs: string[];
  settings: Settings;
  ink: InkPrefs;
  sidebar: boolean;
  panel: Panel;
  palette: null | 'jump' | 'commands';
  capture: boolean;
  shortcuts: boolean;
  /** Bumped when a note's content is replaced externally (restore, import), forcing editors to reload. */
  contentRev: Record<string, number>;
  penSeen: boolean;
  toasts: Toast[];
  indexing: boolean;
}

export const useStore = create<State>(() => ({
  ready: false,
  notes: {},
  notebooks: {},
  tabs: [],
  settings: DEFAULT_SETTINGS,
  ink: { tool: 'pen', pen: { color: 'ink', size: 3 }, hl: { color: 'yellow', size: 16 } },
  sidebar: true,
  panel: null,
  palette: null,
  capture: false,
  shortcuts: false,
  contentRev: {},
  penSeen: false,
  toasts: [],
  indexing: false,
}));

export const getState = useStore.getState;
export const setState = useStore.setState;

let toastId = 0;
export function toast(text: string, action?: Toast['action']) {
  const id = ++toastId;
  setState((s) => ({ toasts: [...s.toasts, { id, text, action }] }));
  setTimeout(() => setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), action ? 6000 : 3200);
}

export function liveNotes(notes: Record<string, NoteMeta>) {
  return Object.values(notes).filter((n) => !n.trashedAt);
}
