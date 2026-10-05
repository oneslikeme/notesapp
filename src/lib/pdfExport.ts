import { BlendMode, PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from 'pdf-lib';
import { getBlob } from './blobs';
import { loadPdfData } from './pdf';
import { outlinePoints, solidColor } from './ink';
import type { PdfDoc } from './types';

function hex(c: string) {
  const h = c.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Helvetica (WinAnsi) can't encode everything; replace what it can't. */
function winAnsi(s: string) {
  return s.replace(/[^\x20-\x7e\xa0-\xff\n]/g, (c) => ({ '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-', '…': '...', '•': '-' })[c] ?? '?');
}

function wrap(font: PDFFont, text: string, size: number, width: number) {
  const out: string[] = [];
  for (const para of winAnsi(text).split('\n')) {
    let line = '';
    for (const w of para.split(' ')) {
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) > width && line) {
        out.push(line);
        line = w;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

export async function exportAnnotatedPdf(d: PdfDoc): Promise<Uint8Array> {
  const blob = await getBlob(d.blobId);
  if (!blob) throw new Error('Original PDF is missing');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pjs = await loadPdfData(bytes.slice());
  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);

  try {
    for (const p of d.pages) {
      let page: PDFPage;
      let conv: (x: number, y: number) => [number, number];
      if (p.src) {
        const [cp] = await out.copyPages(src, [p.src - 1]);
        page = out.addPage(cp);
        const vp = (await pjs.getPage(p.src)).getViewport({ scale: 1 });
        conv = (x, y) => vp.convertToPdfPoint(x, y) as [number, number];
      } else {
        page = out.addPage([p.w, p.h]);
        conv = (x, y) => [x, p.h - y];
      }
      const a = d.ann[p.key];
      if (!a) continue;

      for (const h of a.highlights) {
        const color = hex(solidColor(h.color));
        for (const [x, y, w, hh] of h.rects) {
          const [ax, ay] = conv(x, y);
          const [bx, by] = conv(x + w, y + hh);
          if (h.kind === 'highlight') {
            page.drawRectangle({
              x: Math.min(ax, bx), y: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay),
              color, opacity: 0.45, blendMode: BlendMode.Multiply,
            });
          } else {
            const yy = h.kind === 'underline' ? y + hh - 0.5 : y + hh * 0.55;
            const [sx, sy] = conv(x, yy);
            const [ex, ey] = conv(x + w, yy);
            page.drawLine({ start: { x: sx, y: sy }, end: { x: ex, y: ey }, thickness: Math.max(1, hh * 0.08), color });
          }
        }
      }

      for (const s of a.strokes) {
        const poly = outlinePoints(s);
        if (poly.length < 3) continue;
        // drawSvgPath flips Y, so feed it negated PDF-space Y.
        const path = poly.map(([x, y], i) => {
          const [px, py] = conv(x, y);
          return `${i ? 'L' : 'M'}${px.toFixed(2)} ${(-py).toFixed(2)}`;
        }).join('') + 'Z';
        page.drawSvgPath(path, {
          x: 0, y: 0, color: hex(solidColor(s.color)), borderWidth: 0,
          opacity: s.tool === 'highlighter' ? 0.45 : 1,
          blendMode: s.tool === 'highlighter' ? BlendMode.Multiply : BlendMode.Normal,
        });
      }

      for (const t of a.texts) {
        if (!t.text.trim()) continue;
        const lines = wrap(font, t.text, t.size, t.w);
        lines.forEach((line, i) => {
          const [x, y] = conv(t.x, t.y + t.size * (1 + i * 1.3));
          page.drawText(line, { x, y, size: t.size, font, color: hex(solidColor(t.color)) });
        });
      }
    }
  } finally {
    pjs.loadingTask.destroy();
  }
  return out.save();
}
