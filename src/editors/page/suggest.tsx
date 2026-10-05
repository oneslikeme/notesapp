import { Extension, type Editor, type Range } from '@tiptap/core';
import { ReactRenderer } from '@tiptap/react';
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import { useEffect, useImperativeHandle, useState, type Ref } from 'react';
import {
  Calendar, Code, Heading1, Heading2, Heading3, Image, Link2, List, ListOrdered, ListTodo, Mic, Minus, PenLine, Pilcrow, Plus, Quote,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { titleSuggest } from '../../lib/search';
import { createNote } from '../../lib/actions';
import { noteIcon, noteTitle } from '../../components/noteTypes';
import { putBlob } from '../../lib/blobs';
import { pickFiles } from '../../lib/util';
import type { NoteMeta } from '../../lib/types';

/* ---------------- popup plumbing ---------------- */

interface ListHandle {
  onKeyDown: (e: KeyboardEvent) => boolean;
}

function place(el: HTMLElement, rect: DOMRect | null | undefined) {
  if (!rect) return;
  el.style.position = 'fixed';
  el.style.zIndex = '80';
  const h = el.offsetHeight || 300;
  const below = rect.bottom + 6;
  const top = below + h > window.innerHeight - 8 ? Math.max(8, rect.top - h - 6) : below;
  el.style.top = `${top}px`;
  el.style.left = `${Math.min(rect.left, window.innerWidth - 330)}px`;
}

function popupRender(Comp: any): SuggestionOptions['render'] {
  return () => {
    let r: ReactRenderer<ListHandle> | null = null;
    return {
      onStart(props) {
        r = new ReactRenderer(Comp, { props, editor: props.editor });
        document.body.appendChild(r.element);
        requestAnimationFrame(() => r && place(r.element as HTMLElement, props.clientRect?.()));
      },
      onUpdate(props) {
        r?.updateProps(props);
        requestAnimationFrame(() => r && place(r.element as HTMLElement, props.clientRect?.()));
      },
      onKeyDown(props) {
        if (props.event.key === 'Escape') {
          r?.destroy();
          r?.element.remove();
          r = null;
          return true;
        }
        return r?.ref?.onKeyDown(props.event) ?? false;
      },
      onExit() {
        r?.destroy();
        r?.element.remove();
        r = null;
      },
    };
  };
}

function useListNav(count: number, choose: (i: number) => void, ref: Ref<ListHandle>) {
  const [sel, setSel] = useState(0);
  useEffect(() => setSel(0), [count]);
  useImperativeHandle(ref, () => ({
    onKeyDown: (e) => {
      if (!count) return false;
      if (e.key === 'ArrowDown') return setSel((s) => (s + 1) % count), true;
      if (e.key === 'ArrowUp') return setSel((s) => (s - 1 + count) % count), true;
      if (e.key === 'Enter' || e.key === 'Tab') return choose(sel), true;
      return false;
    },
  }));
  return [sel, setSel] as const;
}

/* ---------------- slash commands ---------------- */

interface SlashItem {
  title: string;
  hint: string;
  icon: LucideIcon;
  keys: string;
  run: (editor: Editor, range: Range) => void;
}

export async function insertImageFiles(editor: Editor, files: File[], pos?: number) {
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    const blobId = await putBlob(f, f.name);
    const node = { type: 'image', attrs: { blobId, alt: f.name, width: 100 } };
    if (pos != null) editor.chain().insertContentAt(pos, node).run();
    else editor.chain().focus().insertContent(node).run();
  }
}

const SLASH: SlashItem[] = [
  { title: 'Text', hint: 'Plain paragraph', icon: Pilcrow, keys: 'paragraph text p', run: (e, r) => e.chain().focus().deleteRange(r).setParagraph().run() },
  { title: 'Heading 1', hint: 'Big section title', icon: Heading1, keys: 'h1 title heading', run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 1 }).run() },
  { title: 'Heading 2', hint: 'Section', icon: Heading2, keys: 'h2 heading subtitle', run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 2 }).run() },
  { title: 'Heading 3', hint: 'Subsection', icon: Heading3, keys: 'h3 heading', run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 3 }).run() },
  { title: 'Handwriting', hint: 'Draw or write with a pen', icon: PenLine, keys: 'ink draw sketch pen handwriting drawing stylus', run: (e, r) => e.chain().focus().deleteRange(r).insertContent({ type: 'inkBlock', attrs: { strokes: [], height: 220 } }).run() },
  { title: 'Audio recording', hint: 'Record from microphone', icon: Mic, keys: 'audio record voice mic sound', run: (e, r) => e.chain().focus().deleteRange(r).insertContent({ type: 'audio', attrs: { createdAt: Date.now() } }).run() },
  { title: 'Image', hint: 'Upload a picture', icon: Image, keys: 'image picture photo screenshot', run: async (e, r) => { e.chain().focus().deleteRange(r).run(); insertImageFiles(e, await pickFiles('image/*', true)); } },
  { title: 'To-do list', hint: 'Track tasks', icon: ListTodo, keys: 'todo task checkbox check', run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run() },
  { title: 'Bulleted list', hint: 'Simple list', icon: List, keys: 'bullet list ul', run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
  { title: 'Numbered list', hint: 'Ordered list', icon: ListOrdered, keys: 'numbered ordered list ol', run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
  { title: 'Quote', hint: 'Block quotation', icon: Quote, keys: 'quote blockquote citation', run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run() },
  { title: 'Code', hint: 'Code block', icon: Code, keys: 'code pre snippet', run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run() },
  { title: 'Divider', hint: 'Horizontal rule', icon: Minus, keys: 'divider hr line separator', run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
  { title: 'Link to note', hint: 'Reference another note', icon: Link2, keys: 'link note wiki reference backlink', run: (e, r) => e.chain().focus().deleteRange(r).insertContent('[[').run() },
  { title: 'Date', hint: "Insert today's date", icon: Calendar, keys: 'date today time now', run: (e, r) => e.chain().focus().deleteRange(r).insertContent(new Date().toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) + ' ').run() },
];

function SlashList({ items, command, ref }: { items: SlashItem[]; command: (i: SlashItem) => void; ref: Ref<ListHandle> }) {
  const [sel, setSel] = useListNav(items.length, (i) => command(items[i]), ref);
  if (!items.length) return <div className="suggest is-empty">No matching blocks</div>;
  return (
    <div className="suggest">
      {items.map((it, i) => {
        const Icon = it.icon;
        return (
          <button key={it.title} className={`suggest-row ${i === sel ? 'is-sel' : ''}`} onMouseEnter={() => setSel(i)} onMouseDown={(e) => (e.preventDefault(), command(it))}>
            <span className="suggest-icon"><Icon size={16} strokeWidth={1.75} /></span>
            <span className="suggest-text">
              <span>{it.title}</span>
              <span className="suggest-hint">{it.hint}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export const SlashCommand = Extension.create({
  name: 'slashCommand',
  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem>({
        editor: this.editor,
        pluginKey: new PluginKey('slash'),
        char: '/',
        startOfLine: false,
        allowedPrefixes: [' ', '\n', '(', ' '],
        items: ({ query }) => {
          const q = query.toLowerCase();
          return SLASH.filter((s) => !q || s.title.toLowerCase().includes(q) || s.keys.includes(q));
        },
        command: ({ editor, range, props }) => props.run(editor, range),
        render: popupRender(SlashList),
      }),
    ];
  },
});

/* ---------------- [[ wiki links ---------------- */

type LinkItem = { note: NoteMeta } | { create: string };

function LinkList({ items, command, query, ref }: { items: LinkItem[]; command: (i: LinkItem) => void; query: string; ref: Ref<ListHandle> }) {
  const [sel, setSel] = useListNav(items.length, (i) => command(items[i]), ref);
  return (
    <div className="suggest">
      <div className="suggest-head">{query ? 'Link to note' : 'Recent notes'}</div>
      {items.map((it, i) => {
        if ('create' in it)
          return (
            <button key="create" className={`suggest-row ${i === sel ? 'is-sel' : ''}`} onMouseEnter={() => setSel(i)} onMouseDown={(e) => (e.preventDefault(), command(it))}>
              <span className="suggest-icon"><Plus size={16} /></span>
              <span className="suggest-text"><span>Create “{it.create}”</span></span>
            </button>
          );
        const Icon = noteIcon(it.note);
        return (
          <button key={it.note.id} className={`suggest-row ${i === sel ? 'is-sel' : ''}`} onMouseEnter={() => setSel(i)} onMouseDown={(e) => (e.preventDefault(), command(it))}>
            <span className="suggest-icon"><Icon size={16} strokeWidth={1.75} /></span>
            <span className="suggest-text"><span>{noteTitle(it.note)}</span></span>
          </button>
        );
      })}
    </div>
  );
}

export const WikiLinkSuggest = Extension.create<{ noteId: string | null }>({
  name: 'wikiLinkSuggest',
  addOptions: () => ({ noteId: null }),
  addProseMirrorPlugins() {
    const self = this.options.noteId ?? undefined;
    return [
      Suggestion<LinkItem>({
        editor: this.editor,
        pluginKey: new PluginKey('wikilink'),
        char: '[[',
        allowSpaces: true,
        allowedPrefixes: null,
        items: ({ query }) => {
          const q = query.replace(/\]+$/, '');
          const list: LinkItem[] = titleSuggest(q, 8, self).map((note) => ({ note }));
          const exact = list.some((x) => 'note' in x && x.note.title.toLowerCase() === q.trim().toLowerCase());
          if (q.trim() && !exact) list.push({ create: q.trim() });
          return list;
        },
        command: async ({ editor, range, props }) => {
          let note: NoteMeta;
          if ('create' in props) note = await createNote('page', { title: props.create, open: false });
          else note = props.note;
          // Swallow an auto-paired closing "]]" if present.
          const after = editor.state.doc.textBetween(range.to, Math.min(range.to + 2, editor.state.doc.content.size), '', '');
          const to = after === ']]' ? range.to + 2 : range.to;
          editor
            .chain()
            .focus()
            .insertContentAt({ from: range.from, to }, [
              { type: 'wikiLink', attrs: { id: note.id, title: note.title || 'Untitled' } },
              { type: 'text', text: ' ' },
            ])
            .run();
        },
        render: popupRender(LinkList),
      }),
    ];
  },
});
