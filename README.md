# Inkwell

A fast, local-first note-taking app for people who live in hundreds of notes: lectures, research, PDFs, sketches and quick thoughts. It runs in the browser, works offline, and can be installed as an app (PWA) on desktop or tablet.

There is no AI anywhere in Inkwell: no chatbots, summaries, auto-organisation or language models. Your notes never leave your device.

## Run it

```bash
cd inkwell
npm install
npm run dev        # http://localhost:5173
```

Production build (offline-capable, installable):

```bash
npm run build
npm run preview    # http://localhost:4173 — use the browser's "Install app" button
```

Use a Chromium-based browser, Safari or Firefox. A pen or stylus works through standard pointer events, including pressure, palm rejection and the pen's eraser button.

## What's in it

| Area | What it does |
| --- | --- |
| **Page notes** | Rich text with headings, lists, to-dos, quotes and code. Type `/` to insert handwriting, audio, images or a date. Handwriting blocks sit inline between paragraphs and grow as you write. A stylus touching the empty space below your text starts a new handwriting block there. |
| **Canvas notes** | Infinite pan/zoom surface for ink, text, sticky notes, images and linked note cards. Images sit under the ink so you can mark up screenshots. Has undo/redo, marquee select, duplicate and fit-to-content. |
| **PDF notes** | Import a PDF, then select text to highlight, underline, strike, comment, or send the quote to another note. Draw with pen or highlighter, add text boxes, insert blank pages for extra writing room, and bookmark pages. Notes sit in a side panel next to the PDF. Export the PDF with your annotations burned in, or export just the highlights as Markdown. |
| **Research notes** | Your own writing beside a column of sources and clips: links, quotes (with source and page), screenshots, attached PDFs and short notes. Paste anything into the clip box. Drag clips into your text, or insert them with one click. |
| **Scratch notes** | Throwaway notes that expire after a set time (7 days by default). Keep one and it becomes a normal note. Expired notes go to Trash first. |
| **Quick capture** | `Alt Q` from anywhere, or the inline box on Home. Save to Scratch or the Inbox, or append to a running note such as a log. Also handles pasted screenshots and voice memos. |
| **Audio** | Record inside any page. Drop bookmarks while recording or playing, change playback speed, download the file. |
| **Links & backlinks** | Type `[[` to link a note, or create one inline. The info panel (`Ctrl/⌘ .`) shows backlinks with context, outgoing links and unlinked mentions. |
| **Search** | Full-text search covers titles, text, tags, research clips, PDF highlights and every page of every PDF, with page-level jump. Supports `"phrases"`, `tag:`, `#tag`, `type:pdf`, `in:"Notebook"`, `is:pinned` and `is:scratch`. |
| **Switching** | Tabs (`Alt 1–9`, `Alt [ ]`, `Alt W`). Recently used notes stay loaded, so switching back is instant. `Ctrl/⌘ K` opens a palette that jumps to any note, searches content, or runs commands with `>`. |
| **Organising** | Nested notebooks (drag notes onto them), tags, pinned notes, an Inbox for unfiled notes, and bulk select/move/tag. |
| **Version history** | Snapshots are saved automatically while you edit, or on demand with `Ctrl/⌘ S` or a named version. A word-level diff compares any version with the current note, and restoring saves the current state first. |
| **Export** | Per note: PDF (via print), Markdown (zipped with attachments), Word, HTML, plain text, PNG/SVG for canvases, annotated PDF, and an Inkwell file. For the whole library: a Markdown export in notebook folders, and a full backup `.zip` that restores losslessly. |

Press `?` in the app to see every keyboard shortcut.

## Architecture

- **Storage:** IndexedDB via Dexie. Note metadata (`notes`) is kept separate from heavy content (`contents`), so the whole library's metadata loads into memory at startup and lists stay instant even with thousands of notes. Binary files (PDFs, audio, images) are stored as blobs. Versions are stored in their own table. The app asks the browser for persistent storage.
- **Search:** MiniSearch keeps an in-memory index with prefix and fuzzy matching. Each PDF page is indexed as its own document so results can jump to a page. The index is rebuilt in the background on launch.
- **Editors:** TipTap/ProseMirror for text, with custom node views for ink, audio, images and wiki-links. The canvas and PDF annotator are custom-built, with ink geometry from `perfect-freehand`. PDF rendering uses pdf.js, with lazy per-page rendering and a text layer. Annotated export uses pdf-lib.
- **Saving:** every editor uses a debounced, flush-on-hide saver, so nothing is lost when switching notes or closing the tab.

```
src/
  lib/        data layer: db, actions, search, saver, ink, pdf, export, backup, importer
  components/ app shell: sidebar, tabs, palette, capture, note header, panels
  editors/    page/, canvas/, pdf/, research/
  views/      home, lists, search, settings
  styles/     design tokens + component styles (light & dark)
```

## Sync across devices (OneDrive)

Inkwell syncs through a private app folder in your own OneDrive (`OneDrive/Apps/Inkwell`). It asks only for access to that folder (`Files.ReadWrite.AppFolder`), never the rest of your files, and no other server is involved.

- **What syncs:** notes (including their PDFs, audio and images), notebooks, tags and pins. Version history and per-device preferences (theme, open tabs) stay local.
- **When it syncs:** on launch, when you return to the app, a few seconds after you edit, every 90 seconds while open, and on **Sync now**.
- **Conflicts:** if the same note changes on two devices before they sync, the other device's version stays in the note and yours is kept as "(conflicted copy)". Nothing is overwritten silently.
- **Sign-in:** Microsoft asks single-page apps to sign in again periodically (about daily). Inkwell then shows **Reconnect OneDrive** in the sidebar; your edits stay safe locally until you do.

### One-time setup

1. Go to <https://entra.microsoft.com> → **App registrations** → **New registration** (sign in with the Microsoft account whose OneDrive you want to use).
2. Name: `Inkwell`. Supported account types: **Accounts in any organizational directory and personal Microsoft accounts**.
3. Redirect URI: platform **Single-page application (SPA)**, URI `https://oneslikeme.github.io/notesapp/`. Click **Register**.
4. In **Authentication**, under the SPA platform, also add `http://localhost:5173/` and `http://localhost:4173/` if you use the local versions.
5. Copy the **Application (client) ID** from the Overview page. It's not a secret.
6. In Inkwell: **Settings → Sync with OneDrive**, paste the ID, **Save**, then **Connect OneDrive**. Do this on each device, or commit the ID in a `.env.production` file as `VITE_ONEDRIVE_CLIENT_ID=<id>` so every device has it built in.

## Hosting (GitHub Pages)

Every push to `main` builds and deploys via `.github/workflows/deploy.yml` to <https://oneslikeme.github.io/notesapp/>. Enable it once in the repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
