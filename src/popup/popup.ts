import type { BackendKind } from '../core/backend';
import { loadSettings, saveSettings, type Message, type Status } from '../messages';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const mode = $<HTMLSelectElement>('mode');
const lang = $<HTMLSelectElement>('lang');
const toggle = $<HTMLButtonElement>('toggle');
const state = $<HTMLDivElement>('state');
let running = false;

function render(status: Status) {
  running = status.state !== 'off' && status.state !== 'error';
  toggle.textContent = running ? 'Stop' : 'Start';
  state.textContent = status.state === 'off' ? '' : status.detail ? `${status.state}: ${status.detail}` : status.state;
}

const send = (message: Message) => chrome.runtime.sendMessage(message);

async function init() {
  const settings = await loadSettings();
  mode.value = settings.mode;
  lang.value = settings.targetLang;
  render((await send({ type: 'popup-status' })) as Status);
}

const persist = () => saveSettings({ mode: mode.value as BackendKind, targetLang: lang.value });
mode.addEventListener('change', persist);
lang.addEventListener('change', persist);
toggle.addEventListener('click', async () => {
  await persist();
  await send({ type: running ? 'popup-stop' : 'popup-start' });
});
chrome.runtime.onMessage.addListener((message: { type: string; status?: Status }) => {
  if (message.type === 'popup-status-update' && message.status) render(message.status);
});
void init();
