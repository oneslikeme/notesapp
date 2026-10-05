import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { getBlob } from './blobs';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const base = import.meta.env.BASE_URL + 'pdfjs/';
const cache = new Map<string, Promise<PDFDocumentProxy>>();
const order: string[] = [];
const refs = new Map<string, number>();

/** Keep up to 4 unused documents warm; never destroy one an open editor still holds. */
function unlist(id: string) {
  const i = order.indexOf(id);
  if (i >= 0) order.splice(i, 1);
}

function evict() {
  for (const id of [...order]) {
    if (order.length <= 4) break;
    if (refs.get(id)) continue;
    unlist(id);
    cache.get(id)?.then((d) => d.loadingTask.destroy()).catch(() => {});
    cache.delete(id);
  }
}

export function releasePdf(blobId: string) {
  refs.set(blobId, Math.max(0, (refs.get(blobId) || 0) - 1));
  evict();
}

export function loadPdfData(data: Uint8Array) {
  return pdfjs.getDocument({
    data,
    cMapUrl: base + 'cmaps/',
    cMapPacked: true,
    standardFontDataUrl: base + 'standard_fonts/',
    wasmUrl: base + 'wasm/',
    iccUrl: base + 'iccs/',
  }).promise;
}

export function openPdf(blobId: string): Promise<PDFDocumentProxy> {
  refs.set(blobId, (refs.get(blobId) || 0) + 1);
  let p = cache.get(blobId);
  if (p) {
    unlist(blobId);
    order.push(blobId);
    return p;
  }
  p = (async () => {
    const blob = await getBlob(blobId);
    if (!blob) throw new Error('PDF file is missing');
    return loadPdfData(new Uint8Array(await blob.arrayBuffer()));
  })();
  cache.set(blobId, p);
  order.push(blobId);
  evict();
  p.catch(() => {
    cache.delete(blobId);
    unlist(blobId);
  });
  return p;
}

export { pdfjs };

export async function pageText(doc: PDFDocumentProxy, n: number) {
  const page = await doc.getPage(n);
  const tc = await page.getTextContent();
  let out = '';
  for (const it of tc.items as any[]) {
    if (!('str' in it)) continue;
    out += it.str;
    out += it.hasEOL ? '\n' : '';
  }
  return out.replace(/[ \t]+/g, ' ');
}

export async function renderThumb(doc: PDFDocumentProxy, n = 1, width = 280) {
  const page = await doc.getPage(n);
  const vp1 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: width / vp1.width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  await page.render({ canvas, viewport: vp }).promise;
  return canvas.toDataURL('image/jpeg', 0.7);
}
