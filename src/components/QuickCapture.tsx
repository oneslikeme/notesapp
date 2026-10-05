import { useEffect, useRef, useState } from 'react';
import { Hourglass, Inbox, Image as ImageIcon, Mic, Send, X, FileText } from 'lucide-react';
import { useStore, setState, toast } from '../lib/store';
import { appendToNote, createNote, openNote } from '../lib/actions';
import { pickNote } from './pickers';
import { putBlob } from '../lib/blobs';
import { looksLikeUrl, modKey, pickFiles } from '../lib/util';
import { AudioRecorderUI } from '../editors/page/nodeviews';
import { flush } from '../lib/saver';
import { noteTitle } from './noteTypes';
import { Segmented } from './ui';

type Dest = 'scratch' | 'inbox' | 'append';

const lsGet = (k: string, d: string) => {
  try {
    return localStorage.getItem(k) ?? d;
  } catch {
    return d;
  }
};

export function QuickCapture() {
  const open = useStore((s) => s.capture);
  if (!open) return null;
  return <Capture />;
}

function Capture() {
  const days = useStore((s) => s.settings.scratchDays);
  const notes = useStore((s) => s.notes);
  const [text, setText] = useState('');
  const [dest, setDest] = useState<Dest>(() => lsGet('capture.dest', 'scratch') as Dest);
  const [target, setTarget] = useState<string | null>(() => lsGet('capture.target', '') || null);
  const [images, setImages] = useState<File[]>([]);
  const [recording, setRecording] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const close = () => setState({ capture: false });
  const targetMeta = target ? notes[target] : undefined;

  useEffect(() => {
    try {
      localStorage.setItem('capture.dest', dest);
      if (target) localStorage.setItem('capture.target', target);
    } catch {}
  }, [dest, target]);

  const chooseTarget = async () => {
    const r = await pickNote({ title: 'Append captures to…', types: ['page', 'research', 'canvas'] });
    if (r && 'id' in r) {
      setTarget(r.id);
      setDest('append');
    }
    ta.current?.focus();
  };

  const buildDoc = async (body: string, audio?: { blobId: string; duration: number; marks: any[] }) => {
    const content: any[] = [];
    for (const line of body.split('\n')) {
      if (!line.trim()) content.push({ type: 'paragraph' });
      else if (looksLikeUrl(line)) content.push({ type: 'paragraph', content: [{ type: 'text', text: line.trim(), marks: [{ type: 'link', attrs: { href: line.trim() } }] }] });
      else content.push({ type: 'paragraph', content: [{ type: 'text', text: line }] });
    }
    for (const f of images) content.push({ type: 'image', attrs: { blobId: await putBlob(f, f.name), width: 100 } });
    if (audio) content.push({ type: 'audio', attrs: { ...audio, createdAt: 0 } });
    if (!content.length) content.push({ type: 'paragraph' });
    return { doc: { type: 'doc', content } };
  };

  const save = async (audio?: { blobId: string; duration: number; marks: any[] }) => {
    const t = text.trim();
    if (!t && !images.length && !audio) return close();
    if (dest === 'append' && targetMeta && !targetMeta.trashedAt && !audio && !images.length) {
      await flush(targetMeta.id);
      await appendToNote(targetMeta.id, t);
      toast(`Added to “${noteTitle(targetMeta)}”`, { label: 'Open', run: () => openNote(targetMeta.id) });
      return close();
    }
    const lines = t.split('\n');
    const title = lines.length > 1 || t.length > 90 ? lines[0].slice(0, 90) : t;
    const body = lines.length > 1 ? lines.slice(1).join('\n').trim() : t.length > 90 ? t : '';
    const meta = await createNote('page', {
      title: audio && !title ? `Voice memo ${new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}` : title,
      doc: await buildDoc(body, audio),
      scratch: dest === 'scratch',
      notebookId: null,
      open: false,
    });
    toast(dest === 'scratch' ? `Captured to Scratch (expires in ${days}d)` : 'Captured to Inbox', { label: 'Open', run: () => openNote(meta.id) });
    close();
  };

  return (
    <div className="modal-backdrop capture-backdrop" onPointerDown={(e) => e.target === e.currentTarget && (text.trim() ? save() : close())}>
      <div className="capture" role="dialog" aria-label="Quick capture">
        <div className="capture-head">
          <span className="capture-title">Quick capture</span>
          <button className="icon-btn" onClick={close} aria-label="Close"><X size={16} /></button>
        </div>
        {recording ? (
          <div className="capture-rec">
            <AudioRecorderUI
              autostart
              onDone={async (res) => {
                setRecording(false);
                if (!res) return;
                const blobId = await putBlob(res.blob, 'voice-memo.webm');
                await save({ blobId, duration: res.duration, marks: res.marks });
              }}
            />
          </div>
        ) : (
          <textarea
            ref={ta}
            autoFocus
            className="capture-text"
            placeholder={'Jot it down — the first line becomes the title.\nPaste links or screenshots too.'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'));
              if (files.length) {
                e.preventDefault();
                setImages((i) => [...i, ...files]);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                save();
              }
              if (e.key === 'Escape') {
                e.stopPropagation();
                close();
              }
            }}
          />
        )}
        {images.length > 0 && (
          <div className="capture-images">
            {images.map((f, i) => (
              <span key={i} className="chip">
                <ImageIcon size={12} /> {f.name || 'pasted image'}
                <button onClick={() => setImages((im) => im.filter((_, j) => j !== i))} aria-label="Remove"><X size={11} /></button>
              </span>
            ))}
          </div>
        )}
        <div className="capture-foot">
          <Segmented<Dest>
            value={dest}
            onChange={(v) => (v === 'append' && !targetMeta ? chooseTarget() : setDest(v))}
            options={[
              { value: 'scratch', label: <><Hourglass size={13} /> Scratch</>, title: `Expires in ${days} days unless kept` },
              { value: 'inbox', label: <><Inbox size={13} /> Inbox</>, title: 'A regular note in your Inbox' },
              { value: 'append', label: <><FileText size={13} /> {targetMeta ? noteTitle(targetMeta).slice(0, 18) : 'Append to…'}</>, title: 'Append to an existing note (e.g. a running log)' },
            ]}
          />
          {dest === 'append' && targetMeta && <button className="btn is-ghost is-small" onClick={chooseTarget}>change</button>}
          <span className="spacer" />
          <button className="icon-btn" title="Attach image" onClick={async () => {
              const f = await pickFiles('image/*', true);
              setImages((i) => [...i, ...f]);
            }}>
            <ImageIcon size={16} />
          </button>
          <button className="icon-btn" title="Record a voice memo" onClick={() => setRecording(true)} disabled={recording}>
            <Mic size={16} />
          </button>
          <button className="btn is-primary" onClick={() => save()}>
            <Send size={14} /> Save <kbd className="kbd on-primary">{modKey} ↵</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}
