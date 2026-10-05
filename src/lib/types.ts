export type NoteType = 'page' | 'canvas' | 'pdf' | 'research';

export interface NoteMeta {
  id: string;
  type: NoteType;
  title: string;
  notebookId: string | null;
  tags: string[];
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  openedAt: number;
  trashedAt: number | null;
  /** Scratch notes expire unless kept. */
  scratch: boolean;
  expiresAt: number | null;
  excerpt: string;
  words: number;
  /** Outgoing links (note ids). */
  links: string[];
  thumb?: string;
}

export interface NoteContent {
  id: string;
  doc: any;
  text: string;
  /** PDF page texts, indexed separately so search can point at a page. */
  pages?: string[];
}

export interface Notebook {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
  order: number;
  collapsed?: boolean;
}

export interface BlobRec {
  id: string;
  blob: Blob;
  name: string;
  mime: string;
  size: number;
  createdAt: number;
}

export interface Version {
  id: string;
  noteId: string;
  createdAt: number;
  title: string;
  doc: any;
  text: string;
  label?: string;
}

/* ---------- Ink ---------- */

export type InkTool = 'pen' | 'highlighter' | 'eraser';

export interface Stroke {
  id: string;
  tool: 'pen' | 'highlighter';
  color: string;
  size: number;
  /** Flat [x, y, pressure, x, y, pressure, ...] */
  pts: number[];
  /** Pressure was simulated (mouse / touch). */
  sim?: boolean;
}

/* ---------- Canvas ---------- */

export interface CanvasStroke extends Stroke {
  type: 'stroke';
}
export interface CanvasText {
  type: 'text';
  id: string;
  x: number;
  y: number;
  w: number;
  text: string;
  size: number;
  /** Sticky-note background colour token, if any. */
  bg?: string;
}
export interface CanvasImage {
  type: 'image';
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  blobId: string;
}
export interface CanvasNoteCard {
  type: 'card';
  id: string;
  x: number;
  y: number;
  w: number;
  noteId: string;
}
export type CanvasItem = CanvasStroke | CanvasText | CanvasImage | CanvasNoteCard;

export interface CanvasDoc {
  items: CanvasItem[];
  view: { x: number; y: number; zoom: number };
  bg: 'dots' | 'grid' | 'lines' | 'plain';
}

/* ---------- PDF ---------- */

export type PdfPageRef = { key: string; src: number | null; w: number; h: number };

export interface PdfHighlight {
  id: string;
  kind: 'highlight' | 'underline' | 'strike';
  color: string;
  rects: [number, number, number, number][];
  text: string;
  comment?: string;
  createdAt: number;
}
export interface PdfTextBox {
  id: string;
  x: number;
  y: number;
  w: number;
  text: string;
  color: string;
  size: number;
}
export interface PdfPageAnn {
  strokes: Stroke[];
  highlights: PdfHighlight[];
  texts: PdfTextBox[];
}

export interface PdfDoc {
  blobId: string;
  fileName: string;
  pages: PdfPageRef[];
  ann: Record<string, PdfPageAnn>;
  notes: any | null;
  lastPage: number;
  zoom: number;
  bookmarks: string[];
}

/* ---------- Research ---------- */

export type ClipKind = 'link' | 'quote' | 'image' | 'pdf' | 'note';
export interface Clip {
  id: string;
  kind: ClipKind;
  createdAt: number;
  url?: string;
  title?: string;
  text?: string;
  source?: string;
  blobId?: string;
  noteId?: string;
  page?: number;
  comment?: string;
}
export interface ResearchDoc {
  question: string;
  clips: Clip[];
  doc: any;
}

export interface PageDoc {
  doc: any;
}

/* ---------- Settings ---------- */

export interface Settings {
  theme: 'system' | 'light' | 'dark';
  font: 'sans' | 'serif';
  width: 'narrow' | 'wide';
  scratchDays: number;
  fingerDraw: 'auto' | 'on' | 'off';
  spellcheck: boolean;
  versionMinutes: number;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  font: 'sans',
  width: 'narrow',
  scratchDays: 7,
  fingerDraw: 'auto',
  spellcheck: true,
  versionMinutes: 10,
};
