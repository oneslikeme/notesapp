import { customAlphabet } from 'nanoid';

const nano = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12);
export const uid = () => nano();

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const modKey = isMac ? '⌘' : 'Ctrl';

const DAY = 86400000;

export function startOfDay(t: number) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function relTime(t: number, now = Date.now()) {
  const diff = now - t;
  if (diff < 45_000) return 'just now';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} min ago`;
  if (t >= startOfDay(now)) return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (t >= startOfDay(now) - DAY) return 'Yesterday';
  if (diff < 6 * DAY) return new Date(t).toLocaleDateString([], { weekday: 'long' });
  const sameYear = new Date(t).getFullYear() === new Date(now).getFullYear();
  return new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' });
}

export function dayBucket(t: number, now = Date.now()) {
  const today = startOfDay(now);
  if (t >= today) return 'Today';
  if (t >= today - DAY) return 'Yesterday';
  if (t >= today - 6 * DAY) return 'Earlier this week';
  if (t >= today - 30 * DAY) return 'Earlier this month';
  return 'Older';
}

export function fullDate(t: number) {
  return new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

export function expiresIn(t: number, now = Date.now()) {
  const diff = t - now;
  if (diff <= 0) return 'expired';
  const h = diff / 3_600_000;
  if (h < 1) return `${Math.max(1, Math.round(diff / 60_000))}m left`;
  if (h < 48) return `${Math.round(h)}h left`;
  return `${Math.round(h / 24)}d left`;
}

export function fmtDuration(sec: number) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const h = Math.floor(m / 60);
  return h ? `${h}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function debounce<T extends (...a: any[]) => void>(fn: T, ms: number) {
  let t: any;
  const d = (...a: Parameters<T>) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
  d.cancel = () => clearTimeout(t);
  return d;
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function safeFileName(s: string) {
  return (s || 'Untitled').replace(/[\/:*?"<>|\n\r\t]+/g, ' ').trim().slice(0, 120) || 'Untitled';
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve(Array.from(input.files || []));
    input.click();
  });
}

export function blobToDataURL(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(b);
  });
}

export function isTypingTarget(el: EventTarget | null) {
  const e = el as HTMLElement | null;
  if (!e) return false;
  return e.isContentEditable || e.tagName === 'INPUT' || e.tagName === 'TEXTAREA' || e.tagName === 'SELECT';
}

export function domainOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function looksLikeUrl(s: string) {
  return /^https?:\/\/\S+$/i.test(s.trim());
}

/** setPointerCapture throws for pointers the browser no longer tracks; never let that abort a gesture. */
export function capturePointer(el: Element | null | undefined, id: number) {
  try {
    el?.setPointerCapture(id);
  } catch {}
}
