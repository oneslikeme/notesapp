// Copies pdf.js runtime data (fonts, cmaps, wasm decoders) into public/ so it works offline.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
const src = 'node_modules/pdfjs-dist';
const dest = 'public/pdfjs';
mkdirSync(dest, { recursive: true });
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  if (existsSync(`${src}/${dir}`)) cpSync(`${src}/${dir}`, `${dest}/${dir}`, { recursive: true });
}
