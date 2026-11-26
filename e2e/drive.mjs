// Launches a separate Brave instance (own profile) with the built extension and drives it over CDP.
// Usage: node e2e/drive.mjs   (needs `pnpm run build` and the llama servers on 8082/8083)
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const BRAVE = process.env.BRAVE_PATH ?? 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
const PORT = 9333;
const profile = mkdtempSync(join(tmpdir(), 'ars-e2e-'));
const MODE = process.env.MODE ?? 'http';
// The browser reads native hosts from <profile>/NativeMessagingHosts first, so the real registry stays untouched.
if (!process.env.NO_PROFILE_HOST) mkdirSync(join(profile, 'NativeMessagingHosts'), { recursive: true });
const bat = join(profile, 'host.bat');
writeFileSync(bat, `@echo off\r\ncd /d "${join(root, 'companion')}"\r\npython -m ai_subtitles_companion bridge\r\n`);
if (!process.env.NO_PROFILE_HOST) writeFileSync(join(profile, 'NativeMessagingHosts', 'com.ai_realtime_subtitles.companion.json'), JSON.stringify({
  name: 'com.ai_realtime_subtitles.companion', description: 'e2e', path: bat, type: 'stdio',
  allowed_origins: ['chrome-extension://fdpmchjhigcggmmcilchcakdnocflcbf/'],
}));
const out = (name) => join(import.meta.dirname, name);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = createServer((req, res) => {
  const file = req.url === '/' ? 'page.html' : decodeURIComponent(req.url.split('?')[0].slice(1));
  const path = resolve(import.meta.dirname, file);
  if (!path.startsWith(import.meta.dirname + sep)) return res.writeHead(403).end(); // stay inside e2e/
  try {
    const body = readFileSync(path);
    res.writeHead(200, { 'content-type': file.endsWith('.wav') ? 'audio/wav' : 'text/html; charset=utf-8', 'accept-ranges': 'bytes' });
    res.end(body);
  } catch { res.writeHead(404).end(); }
}).listen(8765, '127.0.0.1');

const browser = spawn(BRAVE, [
  `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, `--load-extension=${join(root, 'dist')}`,
  ...(process.env.LOG ? ['--enable-logging', '--v=1', '--vmodule=*messaging*=4,*native*=4', `--log-file=${join(import.meta.dirname, 'brave.log')}`] : []),
  '--no-first-run', ...(process.env.TABCAP || process.env.MANUAL ? [] : ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${join(import.meta.dirname, 'sample.wav')}`]), '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required',
  '--disable-features=DisableLoadExtensionCommandLineSwitch', `--whitelisted-extension-id=${process.env.EXT_ID ?? 'gkmehmdhhfaiilhdfbifbmppniaphlma'}`, '--window-size=1100,700', 'http://127.0.0.1:8765/',
], { stdio: 'ignore' });

const cdpList = async () => (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
async function waitFor(fn, what, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(300); }
  throw new Error(`timeout: ${what}`);
}

function attach(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map(); const events = [];
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else events.push(d); };
  const ready = new Promise((r) => (ws.onopen = r));
  const send = async (method, params = {}) => {
    await ready;
    return new Promise((resolve, reject) => {
      const i = ++id;
      const timer = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 15000);
      pending.set(i, (d) => { clearTimeout(timer); resolve(d); });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  };
  const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result; };
  return { send, evaluate, events, close: () => ws.close() };
}

const log = [];
const note = (k, v) => { log.push({ k, v }); console.log(k, typeof v === 'string' ? v : JSON.stringify(v)); };

try {
  const sw = await waitFor(async () => (await cdpList()).find((t) => t.type === 'service_worker' && t.url.endsWith('service-worker.js')), 'service worker');
  const extId = new URL(sw.url).host;
  note('extensionId', extId);
  if (process.env.SHOTS) {
    const shots = [['popup', 'src/popup/popup.html', 340, 520], ['options', 'src/options/options.html', 820, 2600]];
    for (const [name, path, width, height] of shots) {
      const tab = attach(await (await fetch(`http://127.0.0.1:${PORT}/json/new?chrome-extension://${extId}/${path}`, { method: 'PUT' })).json());
      await tab.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false });
      for (const scheme of ['light', 'dark']) {
        await tab.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
        await sleep(600);
        const shot = await tab.send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(out(`ui-${name}-${scheme}.png`), Buffer.from(shot.result.data, 'base64'));
      }
      note(`${name} errors`, await tab.evaluate('document.title'));
    }
    throw new Error('shots done');
  }
  if (process.env.PROBE) {
    const probe = attach(sw);
    for (const name of (process.env.PROBE_NAMES ?? 'com.ai_realtime_subtitles.companion,com.subtitle_anything.llm,com.nonexistent.host').split(',')) {
      note(`probe ${name}`, await probe.evaluate(`Promise.race([new Promise(r => setTimeout(() => r('TIMEOUT (host started, no reply)'), 6000)), new Promise(r => chrome.runtime.sendNativeMessage('${name}', {id: 1, target: 'companion', path: '/status', method: 'GET'}, resp => r(chrome.runtime.lastError ? 'ERR ' + chrome.runtime.lastError.message : JSON.stringify(resp))))])`));
    }
    throw new Error('probe done');
  }
  const page = await waitFor(async () => (await cdpList()).find((t) => t.type === 'page' && t.url.startsWith('http://127.0.0.1:8765')), 'audio page');
  const pageCdp = attach(page);
  note('pageTitle', await pageCdp.evaluate('document.title'));

  // The popup opens as a background tab so the audio page stays the active tab.
  const created = await (await fetch(`http://127.0.0.1:${PORT}/json/new?chrome-extension://${extId}/src/popup/popup.html`, { method: 'PUT' })).json();
  const popup = attach(created);
  await sleep(1000);
  await pageCdp.send('Page.bringToFront');
  await popup.send('Runtime.enable');
  await popup.evaluate(`chrome.storage.local.set({ settings: { mode: '${MODE}', translate: ${process.env.TRANSLATE !== '0'}, targetLang: 'ru'${process.env.TABCAP || process.env.MANUAL ? '' : ", debugAudio: 'microphone'"} } }).then(() => 1)`);
  const swCdp = attach(sw);
  await swCdp.evaluate(`globalThis.__captions = []; chrome.runtime.onMessage.addListener(m => { if (m.type === 'caption' && m.text) globalThis.__captions.push(m.text); }); 1`);
  note('popupTitle', await popup.evaluate('document.title'));
  await popup.evaluate(`window.__statuses = []; chrome.runtime.onMessage.addListener(m => { if (m.type === 'popup-status-update') window.__statuses.push(m.status); }); 1`);
  if (process.env.MANUAL) {
    // The user grants activeTab by clicking the extension icon in the test window, then presses Start in the popup.
    await pageCdp.send('Page.bringToFront');
    note('manual', 'In the test Brave window: click the extension icon (puzzle menu), press "Start subtitles". Waiting 3 minutes.');
  } else if (process.env.TABCAP) {
    // Real path: the keyboard shortcut opens the popup as a user action, which grants activeTab to the audio page.
    note('commands', await attach(sw).evaluate(`chrome.commands.getAll().then(c => JSON.stringify(c))`));
    note('brave windows', await new Promise((r) => { const c = spawn('powershell', ['-NoProfile', '-Command', "Get-Process brave | Where-Object { $_.MainWindowTitle } | ForEach-Object { $_.Id.ToString() + ' ' + $_.MainWindowTitle }"]); let o = ''; c.stdout.on('data', (d) => (o += d)); c.on('close', () => r(o.trim())); }));
    await pageCdp.evaluate(`window.__keys = []; addEventListener('keydown', e => window.__keys.push([e.key, e.ctrlKey, e.shiftKey, e.altKey]), true); 1`);
    await pageCdp.send('Page.bringToFront');
    await popup.send('Page.close').catch(() => {});
    await sleep(500);
    await pageCdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 300, y: 300, button: 'left', clickCount: 1 }); await pageCdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 300, y: 300, button: 'left', clickCount: 1 });
    if (!process.env.SHORTCUT) note('openPopup', await attach(sw).evaluate(`chrome.action.openPopup().then(() => 'ok', e => 'ERR ' + e.message)`));
    let popupTarget = (await cdpList()).find((t) => t.url.includes('src/popup/popup.html'));
    if (!popupTarget) {
      // Fallback: the keyboard shortcut, sent only when the foreground window belongs to this test browser.
      const ps = `Add-Type -AssemblyName System.Windows.Forms; Add-Type 'using System; using System.Runtime.InteropServices; public class W { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid); }'; (New-Object -ComObject WScript.Shell).AppActivate(${browser.pid}) | Out-Null; Start-Sleep -Milliseconds 1200; $pid2 = 0; [W]::GetWindowThreadProcessId([W]::GetForegroundWindow(), [ref]$pid2) | Out-Null; if ($pid2 -eq ${browser.pid}) { [System.Windows.Forms.SendKeys]::SendWait('^+y'); 'sent' } else { 'foreground is another window, nothing sent' }`;
      const result = await new Promise((r) => { const c = spawn('powershell', ['-NoProfile', '-Command', ps]); let o = ''; c.stdout.on('data', (d) => (o += d)); c.on('close', () => r(o.trim())); });
      note('shortcut', result);
    }
    note('keysSeenByPage', await pageCdp.evaluate('JSON.stringify(window.__keys ?? null)'));
    popupTarget = await waitFor(async () => (await cdpList()).find((t) => t.url.includes('src/popup/popup.html')), 'popup opened', 15000).catch(async (e) => { note('targets', (await cdpList()).map((t) => t.type + ':' + t.url.slice(0, 60))); throw e; });
    const shortcutPopup = attach(popupTarget);
    await sleep(800);
    note('shortcutPopupState', await shortcutPopup.evaluate(`document.getElementById('state').textContent`));
    note('start', await shortcutPopup.evaluate(`document.getElementById('toggle').click(); 'clicked'`));
    popup.evaluate = shortcutPopup.evaluate;
  } else
  note('start', await popup.evaluate(`chrome.runtime.sendMessage({type:'popup-start'}).then(()=> 'sent')`));

  // Wait for the first caption (the service worker sees every caption message on its way to the tab).
  const shoot = async (name) => writeFileSync(out(name), Buffer.from((await pageCdp.send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
  const captions = await waitFor(async () => { const c = await swCdp.evaluate('globalThis.__captions'); return c?.length ? c : null; }, 'first caption', process.env.MANUAL ? 180000 : 60000).catch(async (error) => {
    note('statusOnFailure', await popup.evaluate(`chrome.runtime.sendMessage({type:'popup-status'}).then(s => JSON.stringify(s))`));
    throw error;
  });
  await sleep(300);
  note('firstCaption', captions[0]);
  await shoot('caption.png');
  note('statuses', (await popup.evaluate('window.__statuses')).map((s) => s.state).join(','));
  note('overlayHostPresent', await pageCdp.evaluate(`[...document.documentElement.children].some(e => e.style.zIndex === '2147483647')`));

  // Drag the box, then resize it by the corner grip, and read the saved geometry.
  const view = await pageCdp.evaluate('({w: innerWidth, h: innerHeight})');
  const w = Math.round(view.w * 0.6), x0 = Math.round((view.w - w) / 2), y0 = Math.round(view.h * 0.8);
  const mouse = (type, x, y) => pageCdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
  await swCdp.evaluate('chrome.storage.local.remove("overlayBox")');
  // The grip position below assumes a one-line box. Stop the session so no real caption wraps it, then show a short fixed one.
  await popup.evaluate(`chrome.runtime.sendMessage({ type: 'popup-stop' }).then(() => 1)`);
  await sleep(500);
  await swCdp.evaluate(`chrome.tabs.query({ url: 'http://127.0.0.1:8765/*' }).then(([t]) => chrome.tabs.sendMessage(t.id, { type: 'caption', tabId: t.id, text: 'Grip test' })).then(() => 1)`);
  await sleep(300);
  if (process.env.PIPTEST) {
    // A page video enters the native Picture-in-Picture window: the extension must swap it for a canvas with the caption.
    const run = async (expression) => (await pageCdp.send('Runtime.evaluate', { expression, userGesture: true, awaitPromise: true, returnByValue: true })).result?.result?.value;
    note('pipSetup', await run(`(async () => { const c = Object.assign(document.createElement('canvas'), { width: 640, height: 360 }); const g = c.getContext('2d'); setInterval(() => { g.fillStyle = '#245'; g.fillRect(0, 0, 640, 360); g.fillStyle = '#fff'; g.fillRect(Date.now() % 600, 100, 40, 40); }, 30); const v = document.createElement('video'); v.id = 'pipsrc'; v.muted = true; v.srcObject = c.captureStream(30); document.body.append(v); await v.play(); await v.requestPictureInPicture(); return 'entered'; })().catch(e => 'ERR ' + e)`));
    await sleep(2500);
    note('pipError', await run('document.documentElement.dataset.pipError ?? "-"')); note('pipElement', await run(`(() => { const e = document.pictureInPictureElement; return e ? JSON.stringify({ id: e.id, w: e.videoWidth, h: e.videoHeight }) : 'none'; })()`));
    await run(`document.exitPictureInPicture().then(() => 1, () => 0)`);
  }
  await mouse('mousePressed', x0 + w / 2, y0 + 12);
  for (let i = 1; i <= 5; i++) await mouse('mouseMoved', x0 + w / 2 - i * 40, y0 + 12 - i * 60);
  await mouse('mouseReleased', x0 + w / 2 - 200, y0 + 12 - 300);
  await sleep(300);
  const moved = await swCdp.evaluate('chrome.storage.local.get("overlayBox").then(r => r.overlayBox)');
  note('afterDrag', { expected: { x: x0 - 200, y: y0 - 300, width: w }, got: moved });
  await shoot('after-drag.png');
  const gx = moved.x + moved.width - 7, gy = moved.y + 43; // the grip sits in the bottom-right corner of the one-line box
  await mouse('mouseMoved', gx, gy);
  await mouse('mousePressed', gx, gy);
  for (let i = 1; i <= 5; i++) await mouse('mouseMoved', gx + i * 40, gy);
  await mouse('mouseReleased', gx + 200, gy);
  await sleep(300);
  const resized = await swCdp.evaluate('chrome.storage.local.get("overlayBox").then(r => r.overlayBox)');
  note('afterResize', { expectedWidth: moved.width + 200, got: resized });
  await shoot('after-resize.png');
  // Picture-in-Picture button: top-right corner of the box. A trusted mouse click counts as the user gesture.
  const px = resized.x + resized.width - 15, py = resized.y + 15;
  await mouse('mouseMoved', px, py);
  await sleep(300);
  await pageCdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: px, y: py, button: 'left', buttons: 1, clickCount: 1 });
  await pageCdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: px, y: py, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(1500);
  const targets = await cdpList();
  note('targets', targets.map((t) => `${t.type}:${t.url.slice(0, 50)}`));
  const pip = targets.find((t) => t.type === 'page' && !t.url.startsWith('http://127.0.0.1:8765') && !t.url.startsWith('chrome-extension://'));
  if (pip) {
    const pipCdp = attach(pip);
    note('pipText', await pipCdp.evaluate('document.body.innerText'));
    const shot = await pipCdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(out('pip.png'), Buffer.from(shot.result.data, 'base64'));
  }
  note('captionsTotal', (await swCdp.evaluate('globalThis.__captions')).length);
  await popup.evaluate(`chrome.runtime.sendMessage({type:'popup-stop'}).then(()=> 'stopped')`);
} catch (error) {
  note('error', String(error));
  process.exitCode = 1; // a failed run must fail the command that started it
} finally {
  writeFileSync(out('result.json'), JSON.stringify(log, null, 2));
  browser.kill(); server.close();
  spawn('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore' });
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}





