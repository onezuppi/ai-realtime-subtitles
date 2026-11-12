import type { BackendKind } from '../core/backend';
import { loadSettings, saveSettings, type Message, type Status } from '../messages';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const toggle = $<HTMLButtonElement>('toggle');
const state = $<HTMLSpanElement>('state');
const detail = $<HTMLParagraphElement>('detail');
const lang = $<HTMLSelectElement>('lang');
const modeBox = $<HTMLDivElement>('mode');
const modeHint = $<HTMLParagraphElement>('mode-hint');

const HINTS: Record<BackendKind, string> = {
  browser: 'Models run inside the browser. Nothing to install, but slower. Download the models first in Settings.',
  http: 'Fast. The companion program must be running on this computer.',
  native: 'For browsers that cannot reach this computer over HTTP, such as behind a VPN extension or in a Tor window. Install it with companion/install-bridge.',
};
const LABELS: Record<Status['state'], string> = { off: 'Off', loading: 'Loading', listening: 'Listening', busy: 'Working', error: 'Error' };

let mode: BackendKind = 'http';
let running = false;

function renderMode() {
  for (const button of modeBox.querySelectorAll<HTMLButtonElement>('button')) {
    button.setAttribute('aria-checked', String(button.dataset.value === mode));
  }
  modeHint.textContent = HINTS[mode];
}

function render(status: Status) {
  running = status.state !== 'off' && status.state !== 'error';
  toggle.textContent = running ? 'Stop subtitles' : 'Start subtitles';
  toggle.classList.toggle('btn-primary', !running);
  toggle.classList.toggle('btn-stop', running);
  state.textContent = LABELS[status.state];
  state.dataset.state = status.state;
  detail.textContent = status.state === 'error' ? (status.detail ?? 'Something went wrong') : status.state === 'loading' ? (status.detail ?? '') : '';
  detail.dataset.kind = status.state === 'error' ? 'error' : 'info';
}

const send = (message: Message) => chrome.runtime.sendMessage(message);
const persist = () => saveSettings({ ...settingsCache, mode, targetLang: lang.value });
let settingsCache = await loadSettings();

mode = settingsCache.mode;
lang.value = settingsCache.targetLang;
renderMode();
render((await send({ type: 'popup-status' })) as Status);

modeBox.addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest('button');
  if (!button || button.disabled) return;
  mode = button.dataset.value as BackendKind;
  renderMode();
  void persist();
});
lang.addEventListener('change', () => void persist());
toggle.addEventListener('click', async () => {
  await persist();
  await send({ type: running ? 'popup-stop' : 'popup-start' });
});
$('settings').addEventListener('click', () => void chrome.runtime.openOptionsPage());
chrome.runtime.onMessage.addListener((message: { type: string; status?: Status }) => {
  if (message.type === 'popup-status-update' && message.status) render(message.status);
});
