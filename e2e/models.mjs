// Tests the model manager of the Browser mode in a separate Brave: download with progress, ready state, remove.
// A local mirror serves the models that the old project downloaded, so no big download from the internet is needed.
// Usage: node e2e/models.mjs   (needs `pnpm run build`)
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream, statSync, writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const MODELS = process.env.MODELS_DIR ?? join(process.env.USERPROFILE ?? '', 'subtitle-anything-local', 'models');
const BRAVE = process.env.BRAVE_PATH ?? 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
const PORT = 9334;
const MIRROR = 8766;
const SPEED = Number(process.env.SPEED_MBPS ?? 60); // MB per second, so the progress is visible
const profile = mkdtempSync(join(tmpdir(), 'ars-models-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = name => join(import.meta.dirname, name);

const mirror = createServer((req, res) => {
  const match = /^\/(.+?)\/resolve\/[^/]+\/(.+?)(\?.*)?$/.exec(req.url);
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', '*');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  if (!match) return res.writeHead(404).end();
  const override = match[1].includes('cohere-transcribe') ? process.env.COHERE_DIR : undefined;
  const base = override ?? MODELS;
  const file = override ? join(override, ...match[2].split('/')) : join(MODELS, ...match[1].split('/'), ...match[2].split('/'));
  if (!resolve(file).startsWith(resolve(base) + sep)) return res.writeHead(403).end(); // no ../ out of the models folder
  let size;
  try { size = statSync(file).size; } catch { return res.writeHead(404).end(); }
  res.writeHead(200, { 'content-length': size, 'content-type': 'application/octet-stream' });
  if (req.method === 'HEAD') return res.end();
  const stream = createReadStream(file, { highWaterMark: Math.round((SPEED * 1e6) / 20) });
  stream.on('data', chunk => { stream.pause(); res.write(chunk, () => setTimeout(() => stream.resume(), 50)); });
  stream.on('end', () => res.end());
}).listen(MIRROR, '127.0.0.1');

const pageServer = createServer((req, res) => {
  const file = decodeURIComponent(req.url.split('?')[0].slice(1)) || 'page.html';
  const path = resolve(import.meta.dirname, file);
  if (!path.startsWith(import.meta.dirname + sep)) return res.writeHead(403).end(); // stay inside e2e/
  let body; try { body = readFileSync(path); } catch { return res.writeHead(404).end(); }
  res.writeHead(200, { 'access-control-allow-origin': '*', 'content-type': file.endsWith('.wav') ? 'audio/wav' : 'text/html; charset=utf-8' }).end(body);
}).listen(8765, '127.0.0.1');

const browser = spawn(BRAVE, [
  `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, `--load-extension=${join(root, 'dist')}`,
  '--no-first-run', '--no-default-browser-check', '--disable-features=DisableLoadExtensionCommandLineSwitch',
  '--enable-unsafe-webgpu', '--window-size=1000,900', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
  `--use-file-for-fake-audio-capture=${join(import.meta.dirname, 'sample.wav')}`, '--autoplay-policy=no-user-gesture-required', 'http://127.0.0.1:8765/',
], { stdio: 'ignore' });

const cdpList = async () => (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
async function waitFor(fn, what, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(300); }
  throw new Error(`timeout: ${what}`);
}
function attach(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const ready = new Promise(r => (ws.onopen = r));
  const send = async (method, params = {}) => {
    await Promise.race([ready, sleep(15000).then(() => { throw new Error(`CDP connect timeout: ${method}`); })]);
    return new Promise((resolve, reject) => {
      const i = ++id; const timer = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 30000);
      pending.set(i, d => { clearTimeout(timer); resolve(d); });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  };
  const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result; };
  return { send, evaluate };
}
const log = [];
const note = (k, v) => { log.push({ k, v }); console.log(k, typeof v === 'string' ? v : JSON.stringify(v)); };

try {
  const sw = await waitFor(async () => (await cdpList()).find(t => t.type === 'service_worker' && t.url.endsWith('service-worker.js')), 'service worker');
  const extId = new URL(sw.url).host;
  const tab = attach(await (await fetch(`http://127.0.0.1:${PORT}/json/new?chrome-extension://${extId}/src/options/options.html`, { method: 'PUT' })).json());
  await sleep(1500);
  note('webgpu', await tab.evaluate('"gpu" in navigator'));
  // Point the page at the mirror before any download starts.
  if (!process.env.REAL) await tab.evaluate(`(async () => { const s = document.getElementById('modelHost'); s.value = 'http://127.0.0.1:${MIRROR}'; s.dispatchEvent(new Event('change')); return 1; })()`);
  await sleep(500);

  const rowState = name => tab.evaluate(`(() => { const row = [...document.querySelectorAll('.model')].find(r => r.querySelector('.name').textContent.startsWith(${JSON.stringify(name)})); return { status: row.querySelector('.model-status').textContent, bar: row.querySelector('.bar > div').style.width, barHidden: row.querySelector('.bar').hidden, download: !row.querySelector('.download').hidden, remove: !row.querySelector('.remove').hidden, cancel: !row.querySelector('.cancel').hidden }; })()`);
  const click = (name, cls) => tab.evaluate(`[...document.querySelectorAll('.model')].find(r => r.querySelector('.name').textContent.startsWith(${JSON.stringify(name)})).querySelector('.${cls}').click()`);

  for (const name of (process.env.ONLY ?? 'Whisper small,PLaMo 3').split(',').filter(Boolean)) {
    note(`${name} before`, await rowState(name));
    await click(name, 'download');
    const seen = [];
    const end = Date.now() + 240000;
    while (Date.now() < end) {
      const s = await rowState(name);
      if (!seen.length || seen.at(-1) !== s.status) seen.push(s.status);
      if (s.remove || /failed/i.test(s.status)) break;
      await sleep(250);
    }
    note(`${name} progress samples`, seen.length > 12 ? [...seen.slice(0, 5), '...', ...seen.slice(-5)] : seen);
    note(`${name} after`, await rowState(name));
    try { writeFileSync(out(`models-${name.split(' ')[0].toLowerCase()}.png`), Buffer.from((await tab.send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64')); } catch {}
  }
  if (process.env.BENCH) {
    for (const spec of process.env.BENCH.split(',')) {
      const [engine, mt = 'none'] = spec.split('+');
      const cfg = Buffer.from(JSON.stringify({ engine, mt, forced: process.env.FORCED ?? '0', host: 'http://127.0.0.1:' + MIRROR, segments: `http://127.0.0.1:8765/bench/${process.env.SEGMENTS ?? 'segments.json'}` })).toString('base64url');
      const url = `chrome-extension://${extId}/src/dev/bench.html?c=${cfg}`;
      const bench = attach(await (await fetch(`http://127.0.0.1:${PORT}/json/new?${url}`, { method: 'PUT' })).json());
      const result = await waitFor(async () => { const r = await bench.evaluate('JSON.stringify(globalThis.__bench ?? null)'); const o = r && JSON.parse(r); return o?.done ? o : null; }, `bench ${engine}`, 1500000);
      writeFileSync(out(`bench/result${process.env.TAG ?? ''}-${engine}${mt === 'none' ? '' : '+' + mt}.json`), JSON.stringify(result));
      note(`bench ${spec}`, { loadMs: result.loadMs, rows: result.rows.length, error: result.error });
      await fetch(`http://127.0.0.1:${PORT}/json/close/${(await cdpList()).find(t => t.url.includes('bench.html'))?.id}`);
    }
  }
  if (process.env.TRANSCRIBE) {
    const [asr, mt] = process.env.TRANSCRIBE.split('+');
    const popup = attach(await (await fetch(`http://127.0.0.1:${PORT}/json/new?chrome-extension://${extId}/src/popup/popup.html`, { method: 'PUT' })).json());
    await sleep(800);
    await popup.evaluate(`chrome.storage.local.set({ settings: { mode: 'browser', targetLang: 'ru', debugAudio: 'microphone', asrEngine: '${asr}', mtEngine: '${mt}', sourceLang: '${process.env.SOURCE ?? 'auto'}', modelHost: 'http://127.0.0.1:${MIRROR}' } }).then(() => 1)`);
    // The service worker sleeps when idle, so wake it first and attach to its current target.
    await popup.evaluate(`chrome.runtime.sendMessage({type:'popup-status'}).then(() => 1)`);
    const liveSw = await waitFor(async () => (await cdpList()).find(t => t.type === 'service_worker' && t.url.endsWith('service-worker.js')), 'live service worker');
    const swCdp = attach(liveSw);
    await swCdp.evaluate(`globalThis.__captions = []; globalThis.__status = []; chrome.runtime.onMessage.addListener(m => { if (m.type === 'caption' && m.text) globalThis.__captions.push(m.text); if (m.type === 'status') globalThis.__status.push(m.state + ' ' + (m.detail ?? '')); }); 1`);
    const pageTab = (await cdpList()).find(t => t.type === 'page' && t.url.startsWith('http://127.0.0.1:8765'));
    await attach(pageTab).send('Page.bringToFront');
    const started = Date.now();
    note('start', await popup.evaluate(`chrome.runtime.sendMessage({type:'popup-start'}).then(() => 'sent')`));
    const captions = await waitFor(async () => { const c = await swCdp.evaluate('globalThis.__captions'); return c?.length ? c : null; }, 'first caption', 120000).catch(async e => { note('statusOnFailure', await swCdp.evaluate('globalThis.__status.slice(-5)')); throw e; });
    note('firstCaptionAfterMs', Date.now() - started);
    await sleep(8000);
    note('captions', await swCdp.evaluate('globalThis.__captions'));
    note('status', await swCdp.evaluate('[...new Set(globalThis.__status)].slice(0, 8)'));
  }
  if (process.env.REMOVE) {
    const name = process.env.REMOVE;
    await click(name, 'remove'); await sleep(800);
    note(`${name} after remove`, await rowState(name));
  }
} catch (error) {
  note('error', String(error));
  process.exitCode = 1; // a failed run must fail the command that started it
} finally {
  writeFileSync(out('models-result.json'), JSON.stringify(log, null, 2));
  browser.kill(); mirror.close(); pageServer.close();
  spawn('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore' });
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
