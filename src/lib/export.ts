import { zipSync, strToU8 } from 'fflate';
import { db } from './db';
import { getBlob } from './blobs';
import { getState } from './store';
import { cssColor, solidColor, strokeBBox, strokePath } from './ink';
import type { CanvasDoc, NoteMeta, PdfDoc, ResearchDoc, Stroke } from './types';
import { blobToDataURL, downloadBlob, escapeHtml, safeFileName } from './util';
import { collectBlobIds } from './doc';

/* ======================================================================
   Asset context: serializers either embed blobs (data URLs) or reference
   files inside a zip (attachments/…).
   ====================================================================== */

export interface AssetCtx {
  mode: 'embed' | 'files';
  data: Map<string, string>; // blobId -> data URL (embed)
  files: Map<string, { name: string; blob?: Blob; text?: string }>; // key -> file (files mode)
  counter: number;
  titleOf: (id: string) => string;
}

function extFor(mime: string) {
  if (mime.includes('png')) return 'png';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('svg')) return 'svg';
  if (mime.includes('mp4')) return 'm4a';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('pdf')) return 'pdf';
  return 'bin';
}

export async function makeCtx(mode: AssetCtx['mode'], doc: any): Promise<AssetCtx> {
  const notes = getState().notes;
  const ctx: AssetCtx = {
    mode,
    data: new Map(),
    files: new Map(),
    counter: 0,
    titleOf: (id) => notes[id]?.title || 'Untitled',
  };
  for (const id of collectBlobIds(doc)) {
    const b = await getBlob(id);
    if (!b) continue;
    if (mode === 'embed') {
      if (!b.type.startsWith('audio/') && !b.type.includes('pdf')) ctx.data.set(id, await blobToDataURL(b));
    } else ctx.files.set(id, { name: `attachments/${id}.${extFor(b.type)}`, blob: b });
  }
  return ctx;
}

function assetRef(ctx: AssetCtx, blobId: string) {
  return ctx.mode === 'embed' ? ctx.data.get(blobId) ?? '' : ctx.files.get(blobId)?.name ?? '';
}

/* ---------------- Ink → SVG ---------------- */

export function strokesSvg(strokes: Stroke[], opts: { width?: number; height?: number; paper?: boolean; pad?: number } = {}) {
  let { width, height } = opts;
  let ox = 0, oy = 0;
  if (width == null || height == null) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of strokes) {
      const b = strokeBBox(s);
      x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1);
    }
    if (!strokes.length) (x0 = y0 = 0), (x1 = y1 = 10);
    const pad = opts.pad ?? 8;
    ox = x0 - pad; oy = y0 - pad;
    width = x1 - x0 + pad * 2; height = y1 - y0 + pad * 2;
  }
  const paths = strokes
    .map((s) => {
      const fill = opts.paper !== false ? solidColor(s.color) : cssColor(s.color);
      return s.tool === 'highlighter'
        ? `<path d="${strokePath(s)}" fill="${fill}" fill-opacity="0.45" style="mix-blend-mode:multiply"/>`
        : `<path d="${strokePath(s)}" fill="${fill}"/>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${ox} ${oy} ${width} ${height}" width="${Math.round(width)}" height="${Math.round(height)}">${paths}</svg>`;
}

function inkBlockSvg(attrs: any) {
  const strokes: Stroke[] = attrs.strokes || [];
  if (!strokes.length) return null;
  let x1 = 0;
  for (const s of strokes) x1 = Math.max(x1, strokeBBox(s).x1);
  return strokesSvg(strokes, { width: Math.max(200, Math.ceil(x1 + 8)), height: attrs.height || 220 });
}

/* ---------------- TipTap JSON → Markdown ---------------- */

function mdInline(nodes: any[] = [], ctx: AssetCtx): string {
  return nodes
    .map((n) => {
      if (n.type === 'hardBreak') return '  \n';
      if (n.type === 'wikiLink') return `[[${ctx.titleOf(n.attrs.id) || n.attrs.title}]]`;
      if (n.type !== 'text') return '';
      let t: string = n.text || '';
      const marks: any[] = n.marks || [];
      if (marks.some((m) => m.type === 'code')) return '`' + t + '`';
      for (const m of marks) {
        if (m.type === 'bold') t = `**${t}**`;
        else if (m.type === 'italic') t = `*${t}*`;
        else if (m.type === 'strike') t = `~~${t}~~`;
        else if (m.type === 'highlight') t = `==${t}==`;
        else if (m.type === 'underline') t = `<u>${t}</u>`;
      }
      const link = marks.find((m) => m.type === 'link');
      if (link) t = `[${t}](${link.attrs.href})`;
      return t;
    })
    .join('');
}

function mdBlock(n: any, ctx: AssetCtx): string {
  const kids = (n.content || []) as any[];
  switch (n.type) {
    case 'doc':
      return kids.map((k) => mdBlock(k, ctx)).filter((s) => s !== null).join('\n\n');
    case 'paragraph':
      return mdInline(kids, ctx);
    case 'heading':
      return '#'.repeat(n.attrs?.level || 1) + ' ' + mdInline(kids, ctx);
    case 'blockquote':
      return kids.map((k) => mdBlock(k, ctx)).join('\n\n').split('\n').map((l) => `> ${l}`).join('\n');
    case 'codeBlock':
      return '```' + (n.attrs?.language || '') + '\n' + kids.map((k) => k.text || '').join('') + '\n```';
    case 'horizontalRule':
      return '---';
    case 'bulletList':
    case 'orderedList':
    case 'taskList':
      return kids
        .map((li, i) => {
          const bullet = n.type === 'orderedList' ? `${(n.attrs?.start || 1) + i}.` : n.type === 'taskList' ? `- [${li.attrs?.checked ? 'x' : ' '}]` : '-';
          const inner = (li.content || []).map((k: any) => mdBlock(k, ctx)).join('\n\n');
          const pad = ' '.repeat(bullet.length + 1);
          return bullet + ' ' + inner.split('\n').map((l: string, j: number) => (j ? (l ? pad + l : l) : l)).join('\n');
        })
        .join('\n');
    case 'image': {
      const src = n.attrs.blobId ? assetRef(ctx, n.attrs.blobId) : n.attrs.src;
      return `![${n.attrs.alt || 'image'}](${src})`;
    }
    case 'inkBlock': {
      const svg = inkBlockSvg(n.attrs);
      if (!svg) return '';
      if (ctx.mode === 'embed') return `![handwriting](data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))})`;
      const name = `attachments/ink-${++ctx.counter}.svg`;
      ctx.files.set(name, { name, text: svg });
      return `![handwriting](${name})`;
    }
    case 'audio': {
      const f = n.attrs.blobId ? ctx.files.get(n.attrs.blobId) : null;
      const label = `Audio recording (${Math.round(n.attrs.duration || 0)}s)`;
      const marks = (n.attrs.marks || []).map((m: any) => `  - ${fmt(m.t)} ${m.label}`).join('\n');
      return (f ? `[🎙 ${label}](${f.name})` : `🎙 ${label}`) + (marks ? '\n' + marks : '');
    }
    default:
      return kids.length ? kids.map((k) => mdBlock(k, ctx)).join('\n\n') : '';
  }
}

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export function tiptapToMarkdown(doc: any, ctx: AssetCtx) {
  return mdBlock(doc, ctx).replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/* ---------------- TipTap JSON → HTML ---------------- */

function htmlInline(nodes: any[] = [], ctx: AssetCtx): string {
  return nodes
    .map((n) => {
      if (n.type === 'hardBreak') return '<br>';
      if (n.type === 'wikiLink') return `<span class="wikilink">${escapeHtml(ctx.titleOf(n.attrs.id) || n.attrs.title)}</span>`;
      if (n.type !== 'text') return '';
      let t = escapeHtml(n.text || '');
      for (const m of n.marks || []) {
        if (m.type === 'bold') t = `<strong>${t}</strong>`;
        else if (m.type === 'italic') t = `<em>${t}</em>`;
        else if (m.type === 'strike') t = `<s>${t}</s>`;
        else if (m.type === 'code') t = `<code>${t}</code>`;
        else if (m.type === 'highlight') t = `<mark>${t}</mark>`;
        else if (m.type === 'underline') t = `<u>${t}</u>`;
        else if (m.type === 'link') t = `<a href="${escapeHtml(m.attrs.href)}">${t}</a>`;
      }
      return t;
    })
    .join('');
}

function htmlBlock(n: any, ctx: AssetCtx): string {
  const kids = (n.content || []) as any[];
  const inner = () => kids.map((k) => htmlBlock(k, ctx)).join('\n');
  switch (n.type) {
    case 'doc':
      return inner();
    case 'paragraph':
      return `<p>${htmlInline(kids, ctx) || '<br>'}</p>`;
    case 'heading':
      return `<h${n.attrs.level}>${htmlInline(kids, ctx)}</h${n.attrs.level}>`;
    case 'blockquote':
      return `<blockquote>${inner()}</blockquote>`;
    case 'codeBlock':
      return `<pre><code>${escapeHtml(kids.map((k) => k.text || '').join(''))}</code></pre>`;
    case 'horizontalRule':
      return '<hr>';
    case 'bulletList':
      return `<ul>${inner()}</ul>`;
    case 'orderedList':
      return `<ol start="${n.attrs?.start || 1}">${inner()}</ol>`;
    case 'taskList':
      return `<ul class="tasks">${inner()}</ul>`;
    case 'listItem':
      return `<li>${inner()}</li>`;
    case 'taskItem':
      return `<li class="task ${n.attrs.checked ? 'done' : ''}"><input type="checkbox" disabled ${n.attrs.checked ? 'checked' : ''}> <div>${inner()}</div></li>`;
    case 'image': {
      const src = n.attrs.blobId ? assetRef(ctx, n.attrs.blobId) : n.attrs.src;
      return `<figure><img src="${src}" alt="${escapeHtml(n.attrs.alt || '')}" style="width:${n.attrs.width || 100}%"></figure>`;
    }
    case 'inkBlock': {
      const svg = inkBlockSvg(n.attrs);
      return svg ? `<figure class="ink">${svg}</figure>` : '';
    }
    case 'audio':
      return `<p class="audio">🎙 Audio recording · ${fmt(n.attrs.duration || 0)}</p>`;
    default:
      return inner();
  }
}

export function tiptapToHtml(doc: any, ctx: AssetCtx) {
  return htmlBlock(doc, ctx);
}

const DOC_CSS = `
body{font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;color:#1d1d1f;max-width:760px;margin:48px auto;padding:0 24px}
h1{font-size:2em;line-height:1.2;margin:0 0 .6em}h2{margin-top:1.6em}h3{margin-top:1.3em}
img{max-width:100%;border-radius:6px}figure{margin:1.2em 0}figure.ink svg{max-width:100%;height:auto}
blockquote{border-left:3px solid #d0d0d0;margin:1em 0;padding:.1em 1em;color:#555}
pre{background:#f5f5f4;padding:12px 14px;border-radius:8px;overflow:auto}code{font-family:ui-monospace,Consolas,monospace;font-size:.92em}
mark{background:#fff1a8;padding:0 2px;border-radius:2px}.wikilink{color:#3f5bd8;border-bottom:1px solid #c9d1f5}
ul.tasks{list-style:none;padding-left:0}li.task{display:flex;gap:.5em;align-items:flex-start}li.task div p{margin:0}li.task.done div{color:#888;text-decoration:line-through}
.meta{color:#888;font-size:.85em;margin-bottom:2em}.clip{border:1px solid #e5e5e5;border-radius:10px;padding:12px 14px;margin:10px 0}.clip .src{color:#888;font-size:.85em}
@media print{body{margin:0 auto}a{color:inherit}}
`;

export function htmlDocument(title: string, body: string, meta?: NoteMeta) {
  const sub = meta ? `<div class="meta">${new Date(meta.updatedAt).toLocaleString()}${meta.tags.length ? ' · ' + meta.tags.map((t) => '#' + escapeHtml(t)).join(' ') : ''}</div>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${DOC_CSS}</style></head><body><h1>${escapeHtml(title)}</h1>${sub}${body}</body></html>`;
}

/* ---------------- Research → md/html ---------------- */

function clipsMarkdown(d: ResearchDoc, ctx: AssetCtx) {
  if (!d.clips.length) return '';
  const lines = ['## Sources & clips', ''];
  for (const c of d.clips) {
    if (c.kind === 'link') lines.push(`- [${c.title || c.url}](${c.url})${c.comment ? ` — ${c.comment}` : ''}`);
    else if (c.kind === 'quote') lines.push(`> ${(c.text || '').replace(/\n/g, '\n> ')}`, `> — ${c.source || ''}${c.page ? `, p. ${c.page}` : ''}`, c.comment ? `\n${c.comment}` : '', '');
    else if (c.kind === 'image' && c.blobId) lines.push(`![${c.title || 'screenshot'}](${assetRef(ctx, c.blobId)})${c.comment ? `\n${c.comment}` : ''}`, '');
    else if (c.kind === 'pdf') lines.push(`- PDF: [[${c.noteId ? ctx.titleOf(c.noteId) : c.title}]]${c.comment ? ` — ${c.comment}` : ''}`);
    else lines.push(`- ${c.text || ''}${c.comment ? ` — ${c.comment}` : ''}`);
  }
  return lines.join('\n') + '\n';
}

function clipsHtml(d: ResearchDoc, ctx: AssetCtx) {
  if (!d.clips.length) return '';
  const out = ['<h2>Sources &amp; clips</h2>'];
  for (const c of d.clips) {
    const comment = c.comment ? `<p>${escapeHtml(c.comment)}</p>` : '';
    if (c.kind === 'link') out.push(`<div class="clip"><a href="${escapeHtml(c.url || '')}">${escapeHtml(c.title || c.url || '')}</a><div class="src">${escapeHtml(c.url || '')}</div>${comment}</div>`);
    else if (c.kind === 'quote') out.push(`<div class="clip"><blockquote>${escapeHtml(c.text || '')}</blockquote><div class="src">${escapeHtml(c.source || '')}${c.page ? `, p. ${c.page}` : ''}</div>${comment}</div>`);
    else if (c.kind === 'image' && c.blobId) out.push(`<div class="clip"><img src="${assetRef(ctx, c.blobId)}">${comment}</div>`);
    else if (c.kind === 'pdf') out.push(`<div class="clip">PDF: ${escapeHtml(c.noteId ? ctx.titleOf(c.noteId) : c.title || '')}${comment}</div>`);
    else out.push(`<div class="clip">${escapeHtml(c.text || '')}${comment}</div>`);
  }
  return out.join('\n');
}

/* ---------------- Canvas → SVG ---------------- */

export async function canvasSvg(d: CanvasDoc, opts: { dark?: boolean } = {}) {
  const pad = 40;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (a: number, b: number, c: number, e: number) => ((x0 = Math.min(x0, a)), (y0 = Math.min(y0, b)), (x1 = Math.max(x1, c)), (y1 = Math.max(y1, e)));
  const measure = document.createElement('canvas').getContext('2d')!;
  const textLayouts = new Map<string, string[]>();
  for (const it of d.items) {
    if (it.type === 'stroke') {
      const b = strokeBBox(it);
      grow(b.x0, b.y0, b.x1, b.y1);
    } else if (it.type === 'text') {
      measure.font = `${it.size}px Inter, sans-serif`;
      const lines = wrapText(measure, it.text, it.w - (it.bg ? 24 : 0));
      textLayouts.set(it.id, lines);
      grow(it.x, it.y, it.x + it.w, it.y + lines.length * it.size * 1.45 + (it.bg ? 24 : 0));
    } else if (it.type === 'image') grow(it.x, it.y, it.x + it.w, it.y + it.h);
    else if (it.type === 'card') grow(it.x, it.y, it.x + it.w, it.y + 72);
  }
  if (!isFinite(x0)) (x0 = y0 = 0), (x1 = y1 = 100);
  x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  const W = x1 - x0, H = y1 - y0;
  const ink = opts.dark ? '#ececec' : '#1d1d1f';
  const parts: string[] = [`<rect x="${x0}" y="${y0}" width="${W}" height="${H}" fill="${opts.dark ? '#18181b' : '#ffffff'}"/>`];
  const STICKY: Record<string, string> = { yellow: '#fff3b0', pink: '#ffd6e5', blue: '#d6ecff', green: '#d9f5dd', gray: '#ececec' };
  for (const it of d.items) {
    if (it.type === 'stroke') {
      const fill = it.color === 'ink' ? ink : cssColor(it.color);
      parts.push(it.tool === 'highlighter' ? `<path d="${strokePath(it)}" fill="${fill}" fill-opacity="0.45"/>` : `<path d="${strokePath(it)}" fill="${fill}"/>`);
    } else if (it.type === 'text') {
      const lines = textLayouts.get(it.id)!;
      const inset = it.bg ? 12 : 0;
      if (it.bg) parts.push(`<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${lines.length * it.size * 1.45 + 24}" rx="6" fill="${STICKY[it.bg] || STICKY.yellow}"/>`);
      const color = it.bg ? '#1d1d1f' : ink;
      lines.forEach((l, i) =>
        parts.push(`<text x="${it.x + inset}" y="${it.y + inset + it.size * (1.1 + i * 1.45)}" font-family="Inter, -apple-system, Segoe UI, sans-serif" font-size="${it.size}" fill="${color}">${escapeHtml(l)}</text>`),
      );
    } else if (it.type === 'image') {
      const b = await getBlob(it.blobId);
      if (b) parts.push(`<image href="${await blobToDataURL(b)}" x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" preserveAspectRatio="none"/>`);
    } else if (it.type === 'card') {
      const title = getState().notes[it.noteId]?.title || 'Untitled';
      parts.push(`<rect x="${it.x}" y="${it.y}" width="${it.w}" height="64" rx="10" fill="${opts.dark ? '#26262b' : '#f6f6f4'}" stroke="${opts.dark ? '#3a3a40' : '#dddcd7'}"/>`);
      parts.push(`<text x="${it.x + 16}" y="${it.y + 38}" font-family="Inter, sans-serif" font-size="16" font-weight="600" fill="${ink}">${escapeHtml(title)}</text>`);
    }
  }
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${W} ${H}" width="${Math.round(W)}" height="${Math.round(H)}">${parts.join('')}</svg>`, width: W, height: H };
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, width: number) {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      const next = line + word;
      if (ctx.measureText(next).width > width && line.trim()) {
        out.push(line.trimEnd());
        line = word.trimStart();
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

export async function svgToPng(svg: string, w: number, h: number, scale = 2): Promise<Blob> {
  const max = 8000;
  const s = Math.min(scale, max / w, max / h);
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * s);
  c.height = Math.ceil(h * s);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob((b) => res(b!), 'image/png'));
}

/* ---------------- Print (→ PDF via the system dialog) ---------------- */

export function printHtml(html: string) {
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  doc.open();
  doc.write(html);
  doc.close();
  const go = async () => {
    await Promise.all(Array.from(doc.images).map((i) => (i.complete ? null : new Promise((r) => (i.onload = i.onerror = r)))));
    iframe.contentWindow!.focus();
    iframe.contentWindow!.print();
    setTimeout(() => iframe.remove(), 60_000);
  };
  setTimeout(go, 100);
}

/* ======================================================================
   Public: per-note export
   ====================================================================== */

export type ExportFormat = 'md' | 'html' | 'pdf' | 'txt' | 'doc' | 'json' | 'png' | 'svg' | 'pdf-annotated' | 'pdf-original' | 'annotations-md';

export async function noteToMarkdown(meta: NoteMeta, doc: any, ctx: AssetCtx) {
  const head = `# ${meta.title || 'Untitled'}\n\n${meta.tags.length ? meta.tags.map((t) => '#' + t.replace(/\s+/g, '-')).join(' ') + '\n\n' : ''}`;
  if (meta.type === 'page') return head + tiptapToMarkdown(doc.doc, ctx);
  if (meta.type === 'research') {
    const d = doc as ResearchDoc;
    return head + (d.question ? `**Question:** ${d.question}\n\n` : '') + tiptapToMarkdown(d.doc, ctx) + '\n' + clipsMarkdown(d, ctx);
  }
  if (meta.type === 'pdf') return head + pdfAnnotationsMarkdown(doc as PdfDoc, ctx);
  if (meta.type === 'canvas') {
    const { svg } = await canvasSvg(doc);
    const name = `attachments/canvas-${meta.id}.svg`;
    ctx.files.set(name, { name, text: svg });
    const texts = (doc as CanvasDoc).items.filter((i) => i.type === 'text').map((i: any) => i.text);
    return head + (ctx.mode === 'files' ? `![canvas](${name})\n\n` : '') + texts.join('\n\n') + '\n';
  }
  return head;
}

export function pdfAnnotationsMarkdown(d: PdfDoc, ctx: AssetCtx) {
  const out: string[] = [];
  d.pages.forEach((p, i) => {
    const a = d.ann[p.key];
    if (!a) return;
    const items: string[] = [];
    for (const h of a.highlights) items.push(`> ${h.text.replace(/\n/g, ' ')}` + (h.comment ? `\n\n${h.comment}` : ''));
    for (const t of a.texts) if (t.text.trim()) items.push(`- 📝 ${t.text}`);
    if (a.strokes.length) items.push(`- ✍️ ${a.strokes.length} ink stroke${a.strokes.length > 1 ? 's' : ''}`);
    if (items.length) out.push(`## Page ${p.src ?? `${i + 1} (inserted)`}\n\n${items.join('\n\n')}`);
  });
  const notes = d.notes ? `\n\n## Notes\n\n${tiptapToMarkdown(d.notes, ctx)}` : '';
  return (out.length ? out.join('\n\n') : '_No annotations yet._') + notes + '\n';
}

export async function exportNote(id: string, format: ExportFormat) {
  const meta = getState().notes[id];
  const content = await db.contents.get(id);
  if (!meta || !content) return;
  const doc = content.doc;
  const name = safeFileName(meta.title);

  switch (format) {
    case 'json': {
      const blobs: Record<string, { name: string; mime: string; data: string }> = {};
      for (const b of collectBlobIds(doc)) {
        const rec = await db.blobs.get(b);
        if (rec) blobs[b] = { name: rec.name, mime: rec.mime, data: await blobToDataURL(rec.blob) };
      }
      downloadBlob(new Blob([JSON.stringify({ inkwell: 1, meta, content, blobs }, null, 1)], { type: 'application/json' }), `${name}.inkwell.json`);
      return;
    }
    case 'md': {
      const ctx = await makeCtx('files', doc);
      const md = await noteToMarkdown(meta, doc, ctx);
      if (!ctx.files.size) return downloadBlob(new Blob([md], { type: 'text/markdown' }), `${name}.md`);
      const files: Record<string, Uint8Array> = { [`${name}.md`]: strToU8(md) };
      for (const f of ctx.files.values()) files[f.name] = f.blob ? new Uint8Array(await f.blob.arrayBuffer()) : strToU8(f.text || '');
      return downloadBlob(new Blob([zipSync(files) as BlobPart]), `${name}.zip`);
    }
    case 'txt':
      return downloadBlob(new Blob([`${meta.title}\n\n${content.text}`], { type: 'text/plain' }), `${name}.txt`);
    case 'html':
    case 'doc':
    case 'pdf': {
      if (meta.type === 'canvas') {
        const { svg } = await canvasSvg(doc);
        const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(meta.title)}</title><style>body{margin:0}svg{width:100%;height:auto}</style></head><body>${svg}</body></html>`;
        if (format === 'pdf') return printHtml(html);
        return downloadBlob(new Blob([html], { type: 'text/html' }), `${name}.html`);
      }
      const ctx = await makeCtx('embed', doc);
      let body = '';
      if (meta.type === 'page') body = tiptapToHtml(doc.doc, ctx);
      else if (meta.type === 'research') body = (doc.question ? `<p><strong>Question:</strong> ${escapeHtml(doc.question)}</p>` : '') + tiptapToHtml(doc.doc, ctx) + clipsHtml(doc, ctx);
      else if (meta.type === 'pdf') {
        const { marked } = await import('marked');
        body = marked.parse(pdfAnnotationsMarkdown(doc, ctx), { async: false }) as string;
      }
      const html = htmlDocument(meta.title || 'Untitled', body, meta);
      if (format === 'pdf') return printHtml(html);
      if (format === 'doc') {
        // Word opens HTML documents saved with the .doc extension.
        const wordHtml = html.replace('<html>', '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">');
        return downloadBlob(new Blob(['﻿' + wordHtml], { type: 'application/msword' }), `${name}.doc`);
      }
      return downloadBlob(new Blob([html], { type: 'text/html' }), `${name}.html`);
    }
    case 'svg':
    case 'png': {
      const { svg, width, height } = await canvasSvg(doc);
      if (format === 'svg') return downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${name}.svg`);
      return downloadBlob(await svgToPng(svg, width, height), `${name}.png`);
    }
    case 'pdf-original': {
      const b = await getBlob((doc as PdfDoc).blobId);
      if (b) downloadBlob(b, (doc as PdfDoc).fileName || `${name}.pdf`);
      return;
    }
    case 'pdf-annotated': {
      const { exportAnnotatedPdf } = await import('./pdfExport');
      const bytes = await exportAnnotatedPdf(doc as PdfDoc);
      return downloadBlob(new Blob([bytes as BlobPart], { type: 'application/pdf' }), `${name} (annotated).pdf`);
    }
    case 'annotations-md': {
      const ctx = await makeCtx('embed', null);
      return downloadBlob(new Blob([`# ${meta.title}\n\n` + pdfAnnotationsMarkdown(doc, ctx)], { type: 'text/markdown' }), `${name} — annotations.md`);
    }
  }
}

export function exportFormats(meta: NoteMeta): { format: ExportFormat; label: string; hint: string }[] {
  const common = [{ format: 'json' as const, label: 'Inkwell file', hint: '.json' }];
  switch (meta.type) {
    case 'page':
    case 'research':
      return [
        { format: 'pdf', label: 'PDF', hint: 'print' },
        { format: 'md', label: 'Markdown', hint: '.md' },
        { format: 'doc', label: 'Word', hint: '.doc' },
        { format: 'html', label: 'Web page', hint: '.html' },
        { format: 'txt', label: 'Plain text', hint: '.txt' },
        ...common,
      ];
    case 'canvas':
      return [
        { format: 'png', label: 'Image', hint: '.png' },
        { format: 'svg', label: 'Vector', hint: '.svg' },
        { format: 'pdf', label: 'PDF', hint: 'print' },
        { format: 'md', label: 'Markdown', hint: '.md' },
        ...common,
      ];
    case 'pdf':
      return [
        { format: 'pdf-annotated', label: 'PDF with annotations', hint: '.pdf' },
        { format: 'pdf-original', label: 'Original PDF', hint: '.pdf' },
        { format: 'annotations-md', label: 'Highlights & notes', hint: '.md' },
        { format: 'html', label: 'Highlights as web page', hint: '.html' },
        ...common,
      ];
  }
}
