import { useMemo, useState } from 'react';
import { ArrowRight, BookOpenText, FileText, Folder, Hourglass, Library, Mic, Shapes, Zap, Pin, Inbox, Save } from 'lucide-react';
import { useStore, setState, toast } from '../lib/store';
import { createNote, keepScratch, openNote } from '../lib/actions';
import { NoteCard, NoteRow } from '../components/NoteItems';
import { navigate, paths } from '../lib/router';
import { dayBucket, expiresIn, modKey, pickFiles } from '../lib/util';
import { importFiles } from '../lib/importer';
import { noteMenu } from './noteMenu';
import { noteTitle } from '../components/noteTypes';

export function Home() {
  const notes = useStore((s) => s.notes);
  const notebooks = useStore((s) => s.notebooks);
  const live = useMemo(() => Object.values(notes).filter((n) => !n.trashedAt), [notes]);
  const recentOpened = useMemo(() => [...live].sort((a, b) => b.openedAt - a.openedAt).slice(0, 6), [live]);
  const recentEdited = useMemo(() => [...live].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 14), [live]);
  const pinned = live.filter((n) => n.pinned);
  const scratch = live.filter((n) => n.scratch).sort((a, b) => (a.expiresAt ?? 0) - (b.expiresAt ?? 0));
  const nbCounts = useMemo(() => {
    const m = new Map<string, number>();
    live.forEach((n) => n.notebookId && m.set(n.notebookId, (m.get(n.notebookId) || 0) + 1));
    return m;
  }, [live]);
  const topNotebooks = Object.values(notebooks)
    .filter((n) => !n.parentId)
    .sort((a, b) => (nbCounts.get(b.id) || 0) - (nbCounts.get(a.id) || 0))
    .slice(0, 8);
  const now = new Date();

  let bucket = '';
  return (
    <div className="view home">
      <div className="view-inner">
        <header className="home-head">
          <div>
            <div className="home-date">{now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</div>
            <h1 className="home-title">Home</h1>
          </div>
          <div className="home-stats muted">
            {live.length} {live.length === 1 ? 'note' : 'notes'} · {Object.keys(notebooks).length} {Object.keys(notebooks).length === 1 ? 'notebook' : 'notebooks'}
          </div>
        </header>

        <InlineCapture />

        <div className="quick-new">
          <QuickNew icon={FileText} label="Page" hint="Alt N" onClick={() => createNote('page')} />
          <QuickNew icon={Shapes} label="Canvas" onClick={() => createNote('canvas')} />
          <QuickNew icon={Library} label="Research" onClick={() => createNote('research')} />
          <QuickNew icon={BookOpenText} label="Import PDF" onClick={async () => importFiles(await pickFiles('application/pdf,.pdf', true))} />
          <QuickNew icon={Hourglass} label="Scratch" hint="Alt ⇧ N" onClick={() => createNote('page', { scratch: true })} />
          <QuickNew icon={Mic} label="Voice memo" onClick={() => createNote('page', { title: `Voice memo ${now.toLocaleDateString([], { month: 'short', day: 'numeric' })}`, doc: { doc: { type: 'doc', content: [{ type: 'audio', attrs: { createdAt: Date.now() } }, { type: 'paragraph' }] } } })} />
        </div>

        {recentOpened.length > 0 && (
          <section className="home-section">
            <h2>Jump back in</h2>
            <div className="card-row">
              {recentOpened.map((n) => (
                <NoteCard key={n.id} n={n} onContext={(e) => noteMenu(e, n)} />
              ))}
            </div>
          </section>
        )}

        <div className="home-grid">
          <section className="home-section">
            <div className="section-head">
              <h2>Recently edited</h2>
              <button className="link-btn" onClick={() => navigate('/all')}>All notes <ArrowRight size={13} /></button>
            </div>
            <div className="row-list">
              {recentEdited.map((n) => {
                const b = dayBucket(n.updatedAt);
                const head = b !== bucket ? ((bucket = b), <div key={'h' + b} className="list-bucket">{b}</div>) : null;
                return (
                  <div key={n.id}>
                    {head}
                    <NoteRow n={n} showWhere onContext={(e) => noteMenu(e, n)} />
                  </div>
                );
              })}
              {!recentEdited.length && <p className="muted">Nothing yet — create your first note above.</p>}
            </div>
          </section>

          <aside className="home-side">
            {pinned.length > 0 && (
              <section className="home-section">
                <h2><Pin size={14} /> Pinned</h2>
                <div className="mini-list">
                  {pinned.map((n) => (
                    <button key={n.id} className="mini-row" onClick={() => openNote(n.id)}>{noteTitle(n)}</button>
                  ))}
                </div>
              </section>
            )}
            <section className="home-section">
              <div className="section-head">
                <h2><Hourglass size={14} /> Scratch</h2>
                <button className="link-btn" onClick={() => navigate('/scratch')}>View <ArrowRight size={13} /></button>
              </div>
              {scratch.length ? (
                <div className="mini-list">
                  {scratch.slice(0, 6).map((n) => (
                    <div key={n.id} className="mini-row has-actions">
                      <button className="mini-main" onClick={() => openNote(n.id)}>{noteTitle(n)}</button>
                      <span className="mini-meta">{n.expiresAt ? expiresIn(n.expiresAt) : ''}</span>
                      <button className="icon-btn" title="Keep" onClick={() => keepScratch(n.id)}><Save size={13} /></button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted small">Throwaway notes land here and expire on their own. Use Quick Capture or Alt ⇧ N.</p>
              )}
            </section>
            <section className="home-section">
              <h2><Folder size={14} /> Notebooks</h2>
              <div className="mini-list">
                <button className="mini-row" onClick={() => navigate('/inbox')}><Inbox size={13} /> Inbox <span className="mini-meta">{live.filter((n) => !n.notebookId && !n.scratch).length}</span></button>
                {topNotebooks.map((nb) => (
                  <button key={nb.id} className="mini-row" onClick={() => navigate(paths.notebook(nb.id))}>
                    <Folder size={13} /> {nb.name} <span className="mini-meta">{nbCounts.get(nb.id) || 0}</span>
                  </button>
                ))}
              </div>
            </section>
            <p className="home-tip muted small">
              Tip: press <kbd className="kbd">{modKey} K</kbd> to jump anywhere, <kbd className="kbd">Alt Q</kbd> to capture from any screen.
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}

function QuickNew({ icon: Icon, label, hint, onClick }: { icon: any; label: string; hint?: string; onClick: () => void }) {
  return (
    <button className="quick-new-btn" onClick={onClick} title={hint ? `${label} (${hint})` : label}>
      <Icon size={20} strokeWidth={1.6} />
      <span>{label}</span>
    </button>
  );
}

function InlineCapture() {
  const [v, setV] = useState('');
  const days = useStore((s) => s.settings.scratchDays);
  const save = async (scratch: boolean) => {
    const t = v.trim();
    if (!t) return;
    const meta = await createNote('page', { title: t.slice(0, 120), scratch, open: false, notebookId: null });
    setV('');
    toast(scratch ? `Saved to Scratch — expires in ${days}d` : 'Saved to Inbox', { label: 'Open', run: () => openNote(meta.id) });
  };
  return (
    <div className="inline-capture">
      <Zap size={16} className="muted" />
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder="Capture a thought…   Enter → Scratch  ·  Shift+Enter → Inbox"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            save(!e.shiftKey);
          }
        }}
      />
      <button className="btn is-ghost is-small" onClick={() => setState({ capture: true })} title="Open full Quick Capture (Alt Q)">
        More…
      </button>
    </div>
  );
}
