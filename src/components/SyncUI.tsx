import { useEffect, useState } from 'react';
import { Cloud, CloudOff, RefreshCw, AlertTriangle, LogIn, Check } from 'lucide-react';
import { useSync, syncNow, connect, reconnect, disconnect } from '../lib/sync/engine';
import { clientId, clientIdFromBuild, redirectUri, setClientId } from '../lib/sync/onedrive';
import { navigate } from '../lib/router';
import { relTime } from '../lib/util';
import { confirmDialog } from './ui';

/** Compact status in the sidebar. */
export function SyncBadge() {
  const { status, lastSync, progress, pending } = useSync();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  if (status === 'unconfigured' || status === 'off') return null;
  const label =
    status === 'syncing' ? progress ?? 'Syncing…'
    : status === 'reconnect' ? 'Reconnect OneDrive'
    : status === 'offline' ? `Offline${pending ? ` · ${pending} to sync` : ''}`
    : status === 'error' ? 'Sync problem'
    : lastSync ? `Synced ${relTime(lastSync)}` : 'Synced';
  const Icon = status === 'syncing' ? RefreshCw : status === 'offline' ? CloudOff : status === 'error' || status === 'reconnect' ? AlertTriangle : Cloud;
  return (
    <button
      className={`sync-badge is-${status}`}
      title={status === 'idle' ? 'Click to sync now' : label}
      onClick={() => (status === 'reconnect' ? reconnect() : status === 'error' ? navigate('/settings') : syncNow())}
    >
      <Icon size={13} className={status === 'syncing' ? 'spin' : ''} />
      <span>{label}</span>
    </button>
  );
}

/** Settings section. */
export function SyncSettings() {
  const { status, lastSync, error, account, progress, pending } = useSync();
  const [id, setId] = useState(clientId());
  const fromBuild = clientIdFromBuild();

  return (
    <section className="set-section">
      <h2>Sync with OneDrive</h2>
      <p className="muted small">
        Notes, PDFs, audio, images and notebooks sync through a private folder in your OneDrive (<code>Apps/Inkwell</code>). Inkwell can only see that folder. Version history and
        per-device preferences stay on each device. If a note is edited on two devices before they sync, both versions are kept.
      </p>

      {status === 'unconfigured' && (
        <div className="sync-setup">
          <p className="small">
            To connect, Inkwell needs an <strong>Application (client) ID</strong> from a free app registration in your Microsoft account. Register it as a{' '}
            <em>Single-page application</em> with this redirect URI:
          </p>
          <code className="sync-uri">{redirectUri()}</code>
          <div className="row gap" style={{ marginTop: 10 }}>
            <input className="input" value={id} placeholder="Application (client) ID, e.g. 1b2c3d4e-…" onChange={(e) => setId(e.target.value)} />
            <button
              className="btn is-primary"
              disabled={!/^[0-9a-f-]{36}$/i.test(id.trim())}
              onClick={() => {
                setClientId(id);
                location.reload();
              }}
            >
              Save
            </button>
          </div>
        </div>
      )}

      {status === 'off' && (
        <div className="set-buttons">
          <button className="btn is-primary" onClick={() => connect()}>
            <LogIn size={15} /> Connect OneDrive
          </button>
          {!fromBuild && (
            <button className="btn is-ghost" onClick={() => (setClientId(''), location.reload())}>
              Change client ID
            </button>
          )}
        </div>
      )}

      {(status === 'idle' || status === 'syncing' || status === 'error' || status === 'offline' || status === 'reconnect') && (
        <>
          <div className="set-row">
            <div>
              <div className="set-label">
                {status === 'idle' && <Check size={14} className="ok-icon" />} {account}
              </div>
              <div className="set-hint">
                {status === 'syncing' && (progress ?? 'Syncing…')}
                {status === 'idle' && (lastSync ? `Last synced ${relTime(lastSync)}` : 'Connected')}
                {status === 'offline' && `Offline — ${pending} change${pending === 1 ? '' : 's'} will sync when you're back online`}
                {status === 'reconnect' && 'Microsoft asks you to sign in again periodically. Your changes are safe on this device until you do.'}
                {status === 'error' && `Last attempt failed: ${error}`}
              </div>
            </div>
            <div className="set-control row gap">
              {status === 'reconnect' ? (
                <button className="btn is-primary" onClick={() => reconnect()}>
                  <LogIn size={15} /> Reconnect
                </button>
              ) : (
                <button className="btn" disabled={status === 'syncing'} onClick={() => syncNow()}>
                  <RefreshCw size={15} className={status === 'syncing' ? 'spin' : ''} /> Sync now
                </button>
              )}
              <button
                className="btn is-ghost"
                onClick={async () => {
                  if (await confirmDialog({ title: 'Disconnect OneDrive?', body: 'Notes stay on this device and in OneDrive; they just stop syncing here.', confirm: 'Disconnect' })) disconnect();
                }}
              >
                Disconnect
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
