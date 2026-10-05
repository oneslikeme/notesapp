import { useEditor, EditorContent, ReactNodeViewRenderer, type Editor } from '@tiptap/react';
import { Placeholder } from '@tiptap/extensions';
import Typography from '@tiptap/extension-typography';
import { useEffect, useRef, useState } from 'react';
import { Bold, Code, Highlighter, Italic, Link2, Strikethrough, Underline, Heading2, Quote, ExternalLink, Unlink } from 'lucide-react';
import { AudioNode, coreExtensions, ImageNode, InkBlockNode, WikiLinkNode } from './schema';
import { AudioView, ImageView, InkBlockView, WikiLinkView } from './nodeviews';
import { SlashCommand, WikiLinkSuggest, insertImageFiles } from './suggest';
import { useStore } from '../../lib/store';
import { importPdf } from '../../lib/importer';
import { askText } from '../../components/ui';

export interface PageEditorProps {
  noteId: string | null;
  initial: any;
  onDirty: (getDoc: () => any) => void;
  placeholder?: string;
  autofocus?: boolean;
  onReady?: (e: Editor) => void;
  className?: string;
}

export function PageEditor({ noteId, initial, onDirty, placeholder, autofocus, onReady, className = '' }: PageEditorProps) {
  const spellcheck = useStore((s) => s.settings.spellcheck);
  const dirty = useRef(onDirty);
  dirty.current = onDirty;

  const editor = useEditor(
    {
      extensions: [
        ...coreExtensions(),
        Typography,
        Placeholder.configure({
          placeholder: ({ node, pos }) =>
            node.type.name === 'heading' ? 'Heading' : pos === 0 ? placeholder ?? 'Start writing — type / for blocks, [[ to link a note' : '',
          includeChildren: false,
        }),
        InkBlockNode.extend({ addNodeView: () => ReactNodeViewRenderer(InkBlockView) }),
        AudioNode.extend({ addNodeView: () => ReactNodeViewRenderer(AudioView) }),
        ImageNode.extend({ addNodeView: () => ReactNodeViewRenderer(ImageView) }),
        WikiLinkNode.extend({ addNodeView: () => ReactNodeViewRenderer(WikiLinkView, { as: 'span' }) }),
        SlashCommand,
        WikiLinkSuggest.configure({ noteId }),
      ],
      content: initial,
      autofocus: autofocus ? 'end' : false,
      editorProps: {
        attributes: { class: 'prose', spellcheck: String(spellcheck) },
        handlePaste: (view, event) => {
          const files = Array.from(event.clipboardData?.files || []).filter((f) => f.type.startsWith('image/'));
          if (!files.length) return false;
          event.preventDefault();
          const ed = (view as any).editor as Editor | undefined;
          if (ed) insertImageFiles(ed, files);
          else if (editorRef.current) insertImageFiles(editorRef.current, files);
          return true;
        },
        handleDrop: (view, event, _slice, moved) => {
          if (moved) return false;
          const files = Array.from(event.dataTransfer?.files || []);
          if (!files.length) return false;
          event.preventDefault();
          event.stopPropagation();
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
          const ed = editorRef.current;
          if (!ed) return true;
          insertImageFiles(ed, files.filter((f) => f.type.startsWith('image/')), pos);
          for (const f of files.filter((f) => f.type === 'application/pdf')) {
            importPdf(f, f.name, { open: false }).then((m) => {
              if (m) ed.chain().focus().insertContent([{ type: 'wikiLink', attrs: { id: m.id, title: m.title } }, { type: 'text', text: ' ' }]).run();
            });
          }
          return true;
        },
        handleClickOn: (_view, _pos, _node, _nodePos, event) => {
          const a = (event.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
          if (a && !a.closest('.wikilink') && (event.metaKey || event.ctrlKey)) {
            window.open(a.href, '_blank', 'noopener');
            return true;
          }
          return false;
        },
      },
      onUpdate: ({ editor }) => dirty.current(() => editor.getJSON()),
    },
    [noteId],
  );
  const editorRef = useRef<Editor | null>(null);
  editorRef.current = editor;

  useEffect(() => {
    if (editor) onReady?.(editor);
  }, [editor]);

  useEffect(() => {
    editor?.setOptions({ editorProps: { ...editor.options.editorProps, attributes: { class: 'prose', spellcheck: String(spellcheck) } } });
  }, [spellcheck, editor]);

  if (!editor) return null;
  return (
    <div className={`page-editor ${className}`}>
      <FormatBubble editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}

/* ---------------- Selection formatting bubble ---------------- */

function FormatBubble({ editor }: { editor: Editor }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [, force] = useState(0);
  useEffect(() => {
    const update = () => {
      const { state, view } = editor;
      const { from, to, empty } = state.selection;
      if (empty || !view.hasFocus() || (state.selection as any).node) return setPos(null);
      const text = state.doc.textBetween(from, to, ' ');
      if (!text.trim()) return setPos(null);
      const a = view.coordsAtPos(from);
      const b = view.coordsAtPos(to, -1);
      setPos({ x: (a.left + b.right) / 2, y: Math.min(a.top, b.top) });
      force((n) => n + 1);
    };
    const hide = () => setTimeout(() => !editor.view.hasFocus() && setPos(null), 150);
    editor.on('selectionUpdate', update);
    editor.on('transaction', update);
    editor.on('blur', hide);
    return () => {
      editor.off('selectionUpdate', update);
      editor.off('transaction', update);
      editor.off('blur', hide);
    };
  }, [editor]);
  if (!pos) return null;
  const btn = (label: string, Icon: any, active: boolean, run: () => void) => (
    <button
      className={`icon-btn ${active ? 'is-active' : ''}`}
      title={label}
      onMouseDown={(e) => {
        e.preventDefault();
        run();
      }}
    >
      <Icon size={16} strokeWidth={1.9} />
    </button>
  );
  const link = editor.getAttributes('link').href as string | undefined;
  return (
    <div className="bubble" style={{ left: pos.x, top: pos.y }}>
      {btn('Bold (Ctrl+B)', Bold, editor.isActive('bold'), () => editor.chain().focus().toggleBold().run())}
      {btn('Italic (Ctrl+I)', Italic, editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run())}
      {btn('Underline (Ctrl+U)', Underline, editor.isActive('underline'), () => editor.chain().focus().toggleUnderline().run())}
      {btn('Strikethrough', Strikethrough, editor.isActive('strike'), () => editor.chain().focus().toggleStrike().run())}
      {btn('Highlight (Ctrl+Shift+H)', Highlighter, editor.isActive('highlight'), () => editor.chain().focus().toggleHighlight().run())}
      {btn('Inline code', Code, editor.isActive('code'), () => editor.chain().focus().toggleCode().run())}
      <span className="bubble-sep" />
      {btn('Heading', Heading2, editor.isActive('heading'), () => editor.chain().focus().toggleHeading({ level: 2 }).run())}
      {btn('Quote', Quote, editor.isActive('blockquote'), () => editor.chain().focus().toggleBlockquote().run())}
      <span className="bubble-sep" />
      {link ? (
        <>
          {btn('Open link', ExternalLink, false, () => window.open(link, '_blank', 'noopener'))}
          {btn('Remove link', Unlink, false, () => editor.chain().focus().unsetLink().run())}
        </>
      ) : (
        btn('Add link', Link2, false, async () => {
          const url = await askText({ title: 'Link URL', placeholder: 'https://…' });
          if (url) editor.chain().focus().extendMarkRange('link').setLink({ href: /^\w+:/.test(url) ? url : `https://${url}` }).run();
        })
      )}
    </div>
  );
}
