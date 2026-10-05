import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/source-serif-4';
import 'pdfjs-dist/web/pdf_viewer.css';
import './styles/base.css';
import './styles/app.css';
import './styles/editor.css';
import './styles/canvas.css';
import './styles/pdf.css';
import { App } from './App';
import { boot } from './lib/actions';
import { registerSW } from 'virtual:pwa-register';

createRoot(document.getElementById('root')!).render(<App />);
boot()
  .then(async () => {
    // App-icon shortcuts (installed PWA): ?action=capture | new
    const action = new URLSearchParams(location.search).get('action');
    if (!action) return;
    history.replaceState(null, '', location.pathname + location.hash);
    const { setState } = await import('./lib/store');
    if (action === 'capture') setState({ capture: true });
    if (action === 'new') (await import('./lib/actions')).createNote('page');
  })
  .catch((e) => {
  console.error(e);
  document.body.innerHTML = `<div style="font:15px system-ui;padding:40px;max-width:560px;margin:auto"><h2>Inkwell couldn't open its local database</h2><p>${String(e?.message || e)}</p><p>Private/incognito windows and some browser settings block local storage.</p></div>`;
});

if (import.meta.env.PROD) registerSW({ immediate: true });
