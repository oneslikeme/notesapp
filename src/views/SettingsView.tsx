import { useEffect, useState } from 'react';
import { Archive, Download, Keyboard, Upload, ShieldCheck, HardDrive } from 'lucide-react';
import { useStore, setState } from '../lib/store';
import { setSettings } from '../lib/actions';
import { Segmented } from '../components/ui';
import { fmtBytes, pickFiles } from '../lib/util';
import { importFiles } from '../lib/importer';

export function SettingsView() {
  const s = useStore((st) => st.settings);
  const penSeen = useStore((st) => st.penSeen);
  const [usage, setUsage] = useState<{ usage: number; quota: number; persisted: boolean } | null>(null);
  useEffect(() => {
    (async () => {
      const est = await navigator.storage?.estimate?.();
      const persisted = (await navigator.storage?.persisted?.()) ?? false;
      if (est) setUsage({ usage: est.usage ?? 0, quota: est.quota ?? 0, persisted });
    })();
  }, []);

  return (
    <div className="view settings">
      <div className="view-inner narrow">
        <h1 className="view-title">Settings</h1>

        <section className="set-section">
          <h2>Appearance</h2>
          <Row label="Theme">
            <Segmented value={s.theme} onChange={(theme) => setSettings({ theme })} options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
          </Row>
          <Row label="Writing font" hint="Used in page and research notes">
            <Segmented value={s.font} onChange={(font) => setSettings({ font })} options={[{ value: 'sans', label: 'Sans' }, { value: 'serif', label: 'Serif' }]} />
          </Row>
          <Row label="Page width">
            <Segmented value={s.width} onChange={(width) => setSettings({ width })} options={[{ value: 'narrow', label: 'Comfortable' }, { value: 'wide', label: 'Wide' }]} />
          </Row>
        </section>

        <section className="set-section">
          <h2>Writing & ink</h2>
          <Row label="Finger drawing" hint={`Auto: fingers draw until a stylus is used, then fingers only scroll (palm rejection).${penSeen ? ' A stylus has been detected.' : ''}`}>
            <Segmented value={s.fingerDraw} onChange={(fingerDraw) => setSettings({ fingerDraw })} options={[{ value: 'auto', label: 'Auto' }, { value: 'on', label: 'Always' }, { value: 'off', label: 'Never' }]} />
          </Row>
          <Row label="Spellcheck">
            <Segmented value={s.spellcheck ? 'on' : 'off'} onChange={(v) => setSettings({ spellcheck: v === 'on' })} options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} />
          </Row>
        </section>

        <section className="set-section">
          <h2>Scratch & history</h2>
          <Row label="Scratch notes expire after" hint="Expired scratch notes go to Trash, where they stay for 30 more days.">
            <Segmented
              value={String(s.scratchDays)}
              onChange={(v) => setSettings({ scratchDays: Number(v) })}
              options={[{ value: '1', label: '1 day' }, { value: '3', label: '3 days' }, { value: '7', label: '7 days' }, { value: '14', label: '14 days' }, { value: '30', label: '30 days' }]}
            />
          </Row>
          <Row label="Automatic versions" hint="How often a snapshot is kept while you edit.">
            <Segmented
              value={String(s.versionMinutes)}
              onChange={(v) => setSettings({ versionMinutes: Number(v) })}
              options={[{ value: '2', label: '2 min' }, { value: '10', label: '10 min' }, { value: '30', label: '30 min' }, { value: '60', label: '1 hour' }]}
            />
          </Row>
        </section>

        <section className="set-section">
          <h2>Your data</h2>
          <p className="muted small">
            <ShieldCheck size={13} /> Everything is stored locally in this browser. Nothing is uploaded, there are no accounts, and no AI or language
            models are used anywhere in Inkwell. Make backups — clearing site data deletes your notes.
          </p>
          {usage && (
            <p className="muted small">
              <HardDrive size={13} /> Using {fmtBytes(usage.usage)} of {fmtBytes(usage.quota)} available.{' '}
              {usage.persisted ? 'Storage is marked persistent.' : 'Storage is not yet marked persistent (the browser may grant it after you use the app more, or after installing it).'}
            </p>
          )}
          <div className="set-buttons">
            <button className="btn" onClick={async () => (await import('../lib/backup')).exportBackup()}>
              <Archive size={15} /> Download full backup
            </button>
            <button className="btn" onClick={async () => {
              const [f] = await pickFiles('.zip,.json');
              if (f) (await import('../lib/backup')).restoreBackup(f);
            }}>
              <Upload size={15} /> Restore backup…
            </button>
            <button className="btn" onClick={async () => (await import('../lib/backup')).exportLibraryMarkdown()}>
              <Download size={15} /> Export all as Markdown
            </button>
            <button className="btn" onClick={async () => importFiles(await pickFiles('.md,.markdown,.txt,.html,.htm,image/*,.pdf', true))}>
              <Upload size={15} /> Import files…
            </button>
          </div>
        </section>

        <section className="set-section">
          <h2>Keyboard</h2>
          <button className="btn" onClick={() => setState({ shortcuts: true })}>
            <Keyboard size={15} /> Show keyboard shortcuts
          </button>
        </section>
      </div>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="set-row">
      <div>
        <div className="set-label">{label}</div>
        {hint && <div className="set-hint">{hint}</div>}
      </div>
      <div className="set-control">{children}</div>
    </div>
  );
}
