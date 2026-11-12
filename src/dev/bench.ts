// Development only (built with BENCH=1): speed and accuracy of one browser speech model on prepared segments.
import { createBackend } from '../backends/create';
import { BrowserBackend } from '../backends/browser/browser-backend';
import { ASR_ENGINES, type AsrEngineId, type MtEngineId } from '../backends/browser/engines';
import { DEFAULT_SETTINGS } from '../messages';

// The config comes as one base64url JSON value, because the DevTools endpoint that opens the page cuts URLs at "&".
const config = JSON.parse(atob(new URLSearchParams(location.search).get('c')!.replace(/-/g, '+').replace(/_/g, '/')));
const query = new URLSearchParams(config);
const engine = query.get('engine') as AsrEngineId;
const mt = (query.get('mt') ?? 'none') as MtEngineId;
const forced = query.get('forced') === '1';
const log = document.getElementById('log')!;
type Row = { clip: string; lang: string; ref: string; hyp: string; ms: number; seconds: number; mtMs?: number; mtText?: string };
const result: { engine: string; loadMs: number; rows: Row[]; done: boolean; error?: string } = { engine, loadMs: 0, rows: [], done: false };
(globalThis as unknown as { __bench: typeof result }).__bench = result;

try {
  const clips = (await (await fetch(query.get('segments')!)).json()) as { clip: string; lang: string; segments: { ref: string; seconds: number; b64: string }[] }[];
  const backend = createBackend({ ...DEFAULT_SETTINGS, mode: 'browser', asrEngine: engine, mtEngine: mt, modelHost: query.get('host')! }) as BrowserBackend;
  const t0 = performance.now();
  await backend.start();
  result.loadMs = Math.round(performance.now() - t0);
  const info = ASR_ENGINES[engine];
  for (const clip of clips) {
    if (info.sourceCodes && !info.sourceCodes.includes(clip.lang)) continue;
    backend.setSourceLang(forced || info.needsLanguage ? clip.lang : 'auto');
    for (const segment of clip.segments) {
      const bytes = Uint8Array.from(atob(segment.b64), c => c.charCodeAt(0));
      const samples = new Float32Array(bytes.buffer);
      const started = performance.now();
      const { text } = await backend.transcribe(samples);
      const row: Row = { clip: clip.clip, lang: clip.lang, ref: segment.ref, hyp: text, ms: Math.round(performance.now() - started), seconds: segment.seconds };
      if (mt !== 'none' && text) {
        const s = performance.now();
        row.mtText = await backend.translate(text, clip.lang, 'en', []);
        row.mtMs = Math.round(performance.now() - s);
      }
      result.rows.push(row);
      log.textContent = `${result.rows.length} segments`;
    }
  }
} catch (error) {
  result.error = `${String(error)} @ ${query.get('segments')} | ${location.href}`;
}
result.done = true;
log.textContent = 'done';
