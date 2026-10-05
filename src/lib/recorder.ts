import { useEffect, useRef, useState } from 'react';

export type RecState = 'idle' | 'recording' | 'paused';

function pickMime() {
  const opts = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return opts.find((m) => (window as any).MediaRecorder?.isTypeSupported?.(m)) ?? '';
}

export function useRecorder() {
  const [state, setState] = useState<RecState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const r = useRef<{
    rec?: MediaRecorder;
    stream?: MediaStream;
    chunks: Blob[];
    startedAt: number;
    accumulated: number;
    timer?: any;
    raf?: number;
    ctx?: AudioContext;
    resolve?: (v: { blob: Blob; duration: number } | null) => void;
  }>({ chunks: [], startedAt: 0, accumulated: 0 });

  const elapsedNow = () => r.current.accumulated + (state === 'recording' || r.current.startedAt ? (Date.now() - r.current.startedAt) / 1000 : 0);

  const cleanup = () => {
    const c = r.current;
    clearInterval(c.timer);
    if (c.raf) cancelAnimationFrame(c.raf);
    c.stream?.getTracks().forEach((t) => t.stop());
    c.ctx?.close().catch(() => {});
    c.stream = undefined;
    c.ctx = undefined;
  };

  useEffect(() => () => {
    if (r.current.rec && r.current.rec.state !== 'inactive') r.current.rec.stop();
    cleanup();
  }, []);

  const start = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const mime = pickMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const c = r.current;
      c.stream = stream;
      c.rec = rec;
      c.chunks = [];
      c.accumulated = 0;
      c.startedAt = Date.now();
      rec.ondataavailable = (e) => e.data.size && c.chunks.push(e.data);
      rec.onstop = () => {
        const duration = c.accumulated + (c.startedAt ? (Date.now() - c.startedAt) / 1000 : 0);
        const blob = new Blob(c.chunks, { type: rec.mimeType || 'audio/webm' });
        cleanup();
        setState('idle');
        c.resolve?.(c.chunks.length ? { blob, duration } : null);
      };
      rec.start(1000);
      setState('recording');
      setElapsed(0);
      c.timer = setInterval(() => setElapsed(c.accumulated + (c.startedAt ? (Date.now() - c.startedAt) / 1000 : 0)), 250);
      try {
        const ctx = new AudioContext();
        const src = ctx.createMediaStreamSource(stream);
        const an = ctx.createAnalyser();
        an.fftSize = 512;
        src.connect(an);
        c.ctx = ctx;
        const buf = new Uint8Array(an.fftSize);
        const tick = () => {
          an.getByteTimeDomainData(buf);
          let sum = 0;
          for (const v of buf) sum += ((v - 128) / 128) ** 2;
          setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 3));
          c.raf = requestAnimationFrame(tick);
        };
        tick();
      } catch {}
      return true;
    } catch (e: any) {
      setError(e?.name === 'NotAllowedError' ? 'Microphone permission was denied.' : 'No microphone available.');
      return false;
    }
  };

  const pause = () => {
    const c = r.current;
    if (c.rec?.state !== 'recording') return;
    c.rec.pause();
    c.accumulated += (Date.now() - c.startedAt) / 1000;
    c.startedAt = 0;
    setState('paused');
  };
  const resume = () => {
    const c = r.current;
    if (c.rec?.state !== 'paused') return;
    c.rec.resume();
    c.startedAt = Date.now();
    setState('recording');
  };
  const stop = () =>
    new Promise<{ blob: Blob; duration: number } | null>((resolve) => {
      const c = r.current;
      if (!c.rec || c.rec.state === 'inactive') return resolve(null);
      c.resolve = resolve;
      c.rec.stop();
    });

  return { state, elapsed, level, error, start, pause, resume, stop, elapsedNow };
}
