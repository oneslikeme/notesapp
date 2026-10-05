import { BookOpenText, FileText, Hourglass, Library, Shapes } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { NoteMeta, NoteType } from '../lib/types';

export const TYPE_INFO: Record<NoteType, { label: string; icon: LucideIcon; hint: string }> = {
  page: { label: 'Page', icon: FileText, hint: 'Writing with ink, audio and images' },
  canvas: { label: 'Canvas', icon: Shapes, hint: 'Infinite space for ink and ideas' },
  research: { label: 'Research', icon: Library, hint: 'Links, quotes, screenshots, PDFs' },
  pdf: { label: 'PDF', icon: BookOpenText, hint: 'Annotate a PDF' },
};

export function noteIcon(n: Pick<NoteMeta, 'type' | 'scratch'>): LucideIcon {
  return n.scratch ? Hourglass : TYPE_INFO[n.type].icon;
}

export function noteTitle(n: Pick<NoteMeta, 'title' | 'excerpt'> | undefined) {
  if (!n) return 'Missing note';
  return n.title.trim() || (n.excerpt ? n.excerpt.slice(0, 48) : 'Untitled');
}
