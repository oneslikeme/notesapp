import { useEffect, useState } from 'react';
import { Upload } from 'lucide-react';
import { useStore, setState, getState, toast } from './lib/store';
import { useRoute, navigate, getRoute, paths } from './lib/router';
import { Sidebar } from './components/Sidebar';
import { TabBar } from './components/TabBar';
import { NoteView } from './components/NoteView';
import { CommandPalette } from './components/CommandPalette';
import { QuickCapture } from './components/QuickCapture';
import { ShortcutsDialog } from './components/Shortcuts';
import { DialogHost, MenuHost } from './components/ui';
import { Home } from './views/Home';
import { NoteList } from './views/NoteList';
import { SearchView } from './views/SearchView';
import { SettingsView } from './views/SettingsView';
import { closeTab, createNote, openNote, snapshot } from './lib/actions';
import { isTypingTarget } from './lib/util';
import { importFiles } from './lib/importer';
import { flush } from './lib/saver';

const KEEP_ALIVE = 5;

export function App() {
  const ready = useStore((s) => s.ready);
  const sidebar = useStore((s) => s.sidebar);
  const tabs = useStore((s) => s.tabs);
  const notes = useStore((s) => s.notes);
  const route = useRoute();
  const [mounted, setMounted] = useState<string[]>([]);

  useTheme();
  useGlobalKeys();

  // Keep recently viewed notes mounted (hidden) so switching back is instant.
  const activeNote = route.name === 'note' && route.id && notes[route.id] ? route.id : null;
  useEffect(() => {
    if (!activeNote) return;
    setMounted((m) => [activeNote, ...m.filter((x) => x !== activeNote)].slice(0, KEEP_ALIVE));
    if (!getState().tabs.includes(activeNote)) openNote(activeNote);
  }, [activeNote]);
  const alive = mounted.filter((id) => notes[id] && (tabs.includes(id) || id === activeNote));

  if (!ready) return <div className="boot" />;

  return (
    <div className={`app ${sidebar ? 'has-sidebar' : ''}`}>
      {sidebar && <Sidebar />}
      {sidebar && <div className="sidebar-scrim" onClick={() => setState({ sidebar: false })} />}
      <main className="main">
        <TabBar />
        <div className="content">
          {alive.map((id) => (
            <div key={id} className="note-host" hidden={id !== activeNote}>
              <NoteView id={id} active={id === activeNote} />
            </div>
          ))}
          {!activeNote && (
            <div className="view-host">
              {route.name === 'home' && <Home />}
              {route.name === 'search' && <SearchView route={route} />}
              {route.name === 'settings' && <SettingsView />}
              {['notebook', 'tag', 'inbox', 'all', 'pinned', 'scratch', 'trash'].includes(route.name) && <NoteList route={route} />}
              {route.name === 'note' && <NoteMissing />}
            </div>
          )}
        </div>
      </main>
      <CommandPalette />
      <QuickCapture />
      <ShortcutsDialog />
      <DropZone />
      <Toasts />
      <MenuHost />
      <DialogHost />
    </div>
  );
}

function NoteMissing() {
  useEffect(() => {
    toast('That note no longer exists');
    navigate('/', true);
  }, []);
  return null;
}

function useTheme() {
  const theme = useStore((s) => s.settings.theme);
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#17171a' : '#fbfbfa');
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
}

function useGlobalKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const s = getState();
      const route = getRoute();
      const cur = route.name === 'note' ? route.id : undefined;
      const code = e.code;

      if (mod && !e.shiftKey && !e.altKey && code === 'KeyK') return e.preventDefault(), setState({ palette: s.palette ? null : 'jump' });
      if (mod && e.shiftKey && (code === 'KeyP' || code === 'KeyK')) return e.preventDefault(), setState({ palette: 'commands' });
      if (mod && e.shiftKey && code === 'KeyF') return e.preventDefault(), setState({ palette: null }), navigate(paths.search());
      if ((e.altKey && !mod && code === 'KeyQ') || (mod && e.shiftKey && code === 'Space')) return e.preventDefault(), setState({ capture: true, palette: null });
      if (e.altKey && !mod && code === 'KeyN') return e.preventDefault(), createNote('page', { scratch: e.shiftKey });
      if (e.altKey && !mod && code === 'KeyW' && cur) return e.preventDefault(), closeTab(cur);
      if (e.altKey && !mod && /^Digit[1-9]$/.test(code)) {
        const i = Number(code.slice(5)) - 1;
        const id = i === 8 ? s.tabs[s.tabs.length - 1] : s.tabs[i];
        if (id) (e.preventDefault(), openNote(id));
        return;
      }
      if (e.altKey && !mod && (code === 'BracketLeft' || code === 'BracketRight') && s.tabs.length) {
        e.preventDefault();
        const i = cur ? s.tabs.indexOf(cur) : -1;
        const n = s.tabs.length;
        const next = s.tabs[(i + (code === 'BracketRight' ? 1 : -1) + n) % n];
        if (next) openNote(next);
        return;
      }
      if (mod && code === 'Backslash') return e.preventDefault(), setState({ sidebar: !s.sidebar });
      if (mod && code === 'Period' && cur) return e.preventDefault(), setState({ panel: s.panel === 'info' ? null : 'info' });
      if (mod && !e.shiftKey && code === 'KeyS') {
        e.preventDefault();
        if (cur) flush(cur).then(() => snapshot(cur, undefined, undefined, 'Saved manually')).then(() => toast('Version saved — changes are also saved automatically'));
        return;
      }
      if (mod && code === 'Slash') return e.preventDefault(), setState({ shortcuts: !s.shortcuts });
      if (e.key === '?' && !isTypingTarget(e.target) && !mod) return setState({ shortcuts: true });
      if (e.key === 'Escape' && window.innerWidth < 900 && s.sidebar) setState({ sidebar: false });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function DropZone() {
  const [over, setOver] = useState(false);
  useEffect(() => {
    let depth = 0;
    const isFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files');
    const enter = (e: DragEvent) => {
      if (!isFiles(e)) return;
      depth++;
      setOver(true);
    };
    const leave = (e: DragEvent) => {
      if (!isFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setOver(false);
    };
    const overFn = (e: DragEvent) => isFiles(e) && e.preventDefault();
    const drop = (e: DragEvent) => {
      depth = 0;
      setOver(false);
      if (!isFiles(e) || e.defaultPrevented) return;
      e.preventDefault();
      const files = Array.from(e.dataTransfer!.files);
      const route = getRoute();
      importFiles(files, { notebookId: route.name === 'notebook' ? route.id ?? null : undefined });
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', overFn);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', overFn);
      window.removeEventListener('drop', drop);
    };
  }, []);
  if (!over) return null;
  return (
    <div className="dropzone">
      <div>
        <Upload size={28} />
        <strong>Drop to import</strong>
        <span>PDFs, Markdown, text, images — or drop onto a note to insert</span>
      </div>
    </div>
  );
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <span>{t.text}</span>
          {t.action && (
            <button
              className="toast-action"
              onClick={() => {
                t.action!.run();
                setState((s) => ({ toasts: s.toasts.filter((x) => x.id !== t.id) }));
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
