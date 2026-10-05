import type { Editor } from '@tiptap/react';

/** Live TipTap editors by note id (outline, insert-from-research, etc.). */
export const liveEditors = new Map<string, Editor>();
