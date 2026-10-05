import { Node, mergeAttributes, type Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Highlight from '@tiptap/extension-highlight';

const json = (name: string, fallback: any) => ({
  default: fallback,
  parseHTML: (el: HTMLElement) => {
    try {
      return JSON.parse(el.getAttribute(`data-${name}`) || '');
    } catch {
      return fallback;
    }
  },
  renderHTML: (attrs: any) => ({ [`data-${name}`]: JSON.stringify(attrs[name] ?? fallback) }),
});

export const InkBlockNode = Node.create({
  name: 'inkBlock',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      strokes: json('strokes', []),
      height: {
        default: 220,
        parseHTML: (el) => Number(el.getAttribute('data-height')) || 220,
        renderHTML: (a) => ({ 'data-height': a.height }),
      },
      bg: { default: 'plain', parseHTML: (el) => el.getAttribute('data-bg') || 'plain', renderHTML: (a) => ({ 'data-bg': a.bg }) },
    };
  },
  parseHTML: () => [{ tag: 'div[data-ink]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-ink': '' })],
});

export const AudioNode = Node.create({
  name: 'audio',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      blobId: { default: null, parseHTML: (el) => el.getAttribute('data-blob'), renderHTML: (a) => ({ 'data-blob': a.blobId }) },
      duration: { default: 0, parseHTML: (el) => Number(el.getAttribute('data-duration')) || 0, renderHTML: (a) => ({ 'data-duration': a.duration }) },
      marks: json('marks', []),
      createdAt: { default: 0, parseHTML: (el) => Number(el.getAttribute('data-created')) || 0, renderHTML: (a) => ({ 'data-created': a.createdAt }) },
    };
  },
  parseHTML: () => [{ tag: 'div[data-audio]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-audio': '' })],
});

export const ImageNode = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      blobId: { default: null, parseHTML: (el) => el.getAttribute('data-blob'), renderHTML: (a) => (a.blobId ? { 'data-blob': a.blobId } : {}) },
      src: { default: null, parseHTML: (el) => (el.getAttribute('data-blob') ? null : el.getAttribute('src')), renderHTML: (a) => (a.src ? { src: a.src } : {}) },
      alt: { default: '' },
      width: { default: 100, parseHTML: (el) => Number(el.getAttribute('data-width')) || 100, renderHTML: (a) => ({ 'data-width': a.width }) },
    };
  },
  parseHTML: () => [{ tag: 'img' }],
  renderHTML: ({ HTMLAttributes }) => ['img', HTMLAttributes],
});

export const WikiLinkNode = Node.create({
  name: 'wikiLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      id: { default: null, parseHTML: (el) => el.getAttribute('data-id'), renderHTML: (a) => ({ 'data-id': a.id }) },
      title: { default: '', parseHTML: (el) => el.textContent || '', renderHTML: () => ({}) },
    };
  },
  parseHTML: () => [{ tag: 'a[data-wikilink]' }],
  renderHTML: ({ node, HTMLAttributes }) => ['a', mergeAttributes(HTMLAttributes, { 'data-wikilink': '', class: 'wikilink' }), node.attrs.title || 'note'],
  renderText: ({ node }) => `[[${node.attrs.title}]]`,
});

export function coreExtensions(): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false, autolink: true, linkOnPaste: true, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } },
      trailingNode: {},
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Highlight.configure({ multicolor: false }),
  ];
}

/** Schema-only extension list (no React node views) — used for HTML/Markdown import. */
export function schemaExtensions(): Extensions {
  return [...coreExtensions(), InkBlockNode, AudioNode, ImageNode, WikiLinkNode];
}
