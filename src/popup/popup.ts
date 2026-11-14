import { ASR_ENGINES, COMPANION_MODELS, MT_ENGINES, requiresDownload } from '../backends/browser/engines';
import { isDownloaded } from '../backends/browser/models/model-store';
import type { BackendKind } from '../core/backend';
import { sourceLanguageChoices, validSourceLanguage } from '../shared/languages';
import type { Message, SessionState, Status } from '../shared/messages';
import { loadSettings, updateSettings } from '../shared/settings-store';
import { $ } from '../ui/dom';
import { fillTargetLanguages } from '../ui/target-languages';

const toggle = $<HTMLButtonElement>('toggle');
const state = $<HTMLSpanElement>('state');
const detail = $<HTMLParagraphElement>('detail');
const lang = $<HTMLSelectElement>('lang');
const modeBox = $<HTMLDivElement>('mode');
const translateBox = $<HTMLDivElement>('translate-mode');
const targetLabel = $<HTMLElement>('target-label');
const modelsBox = $<HTMLDListElement>('models');
const sourceLabel = $<HTMLElement>('source-label');
const sourceLang = $<HTMLSelectElement>('source-lang');

const HINTS: Record<BackendKind, string> = {
  browser: 'Models run inside the browser. Nothing to install, but slower. Download the models first in Settings.',
  http: 'Fast. The companion program must be running on this computer.',
  native: 'For browsers that cannot reach this computer over HTTP, such as behind a VPN extension or in a Tor window. Install it with companion/install-bridge.',
};
const LABELS: Record<SessionState, string> = { off: 'Off', loading: 'Loading', listening: 'Listening', busy: 'Working', error: 'Error' };

let mode: BackendKind = 'http';
let translate = true;
let running = false;

function renderTranslate() {
  for (const button of translateBox.querySelectorAll<HTMLButtonElement>('button')) {
    button.setAttribute('aria-checked', String((button.dataset.value === 'on') === translate));
  }
  targetLabel.hidden = lang.hidden = !translate;
  void renderModels();
}

/** Lists the models that will run, so the user sees what is used and, in the Browser mode, what is still to download. */
async function renderModels() {
  const current = await loadSettings();
  const rows: { name: string; model: string; state?: 'ok' | 'missing' }[] = [];
  if (mode === 'browser') {
    const asr = ASR_ENGINES[current.asrEngine];
    rows.push({ name: 'Speech', model: asr.label, state: (await isDownloaded({ kind: 'asr', id: asr.id })) ? 'ok' : 'missing' });
    if (translate) {
      const mt = MT_ENGINES[current.mtEngine];
      rows.push({ name: 'Translation', model: mt.label, state: !requiresDownload(mt) || (await isDownloaded({ kind: 'mt', id: mt.id })) ? 'ok' : 'missing' });
    }
  } else {
    rows.push({ name: 'Speech', model: COMPANION_MODELS.asr });
    if (translate) rows.push({ name: 'Translation', model: COMPANION_MODELS.mt });
  }
  modelsBox.replaceChildren(
    ...rows.flatMap(row => {
      const term = document.createElement('dt');
      term.textContent = row.name;
      const value = document.createElement('dd');
      value.textContent = row.state === 'missing' ? `${row.model} (download in Settings)` : row.model;
      if (row.state === 'missing') value.className = 'missing';
      return [term, value];
    }),
  );
}

/** The language of the audio, shown for the Browser mode. A model that cannot detect the language makes the choice required. */
async function renderSource() {
  sourceLabel.hidden = sourceLang.hidden = mode !== 'browser';
  if (mode !== 'browser') return;
  const current = await loadSettings();
  const engine = ASR_ENGINES[current.asrEngine];
  sourceLang.replaceChildren(...sourceLanguageChoices(engine).map(option => new Option(option.label, option.code)));
  const valid = validSourceLanguage(engine, current.sourceLang);
  if (valid !== current.sourceLang) await updateSettings({ sourceLang: valid });
  sourceLang.value = valid;
  sourceLang.disabled = running;
  sourceLang.title = engine.needsLanguage ? `${engine.label} cannot detect the language, so choose it here.` : 'Detected automatically. Choose a language only if it guesses wrong.';
}

/** While subtitles run, the choices are frozen: a change would apply to the next start, not to the running session. */
function applyLock() {
  for (const button of document.querySelectorAll<HTMLButtonElement>('#mode button, #translate-mode button')) button.disabled = running;
  lang.disabled = running;
  sourceLang.disabled = running;
  const frozen = running ? 'Stop the subtitles to change this.' : '';
  for (const control of [modeBox, translateBox, lang, sourceLang]) control.title = frozen;
}

function renderMode() {
  for (const button of modeBox.querySelectorAll<HTMLButtonElement>('button')) {
    button.setAttribute('aria-checked', String(button.dataset.value === mode));
  }
  if (!running) modeBox.title = HINTS[mode];
  void renderModels();
  void renderSource();
}

function render(status: Status) {
  running = status.state !== 'off' && status.state !== 'error';
  applyLock();
  toggle.textContent = running ? 'Stop subtitles' : 'Start subtitles';
  toggle.classList.toggle('btn-primary', !running);
  toggle.classList.toggle('btn-stop', running);
  state.textContent = LABELS[status.state];
  state.dataset.state = status.state;
  detail.textContent = status.state === 'error' ? (status.detail ?? 'Something went wrong') : status.state === 'loading' ? (status.detail ?? '') : '';
  detail.dataset.kind = status.state === 'error' ? 'error' : 'info';
}

const send = (message: Message) => chrome.runtime.sendMessage(message);
const persist = () => updateSettings({ mode, translate, targetLang: lang.value });

fillTargetLanguages(lang);
const settings = await loadSettings();
mode = settings.mode;
translate = settings.translate;
lang.value = settings.targetLang;
renderMode();
renderTranslate();
render((await send({ type: 'popup-status' })) as Status);

modeBox.addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest('button');
  if (!button || button.disabled) return;
  mode = button.dataset.value as BackendKind;
  renderMode();
  void persist();
});
translateBox.addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest('button');
  if (!button || button.disabled) return;
  translate = button.dataset.value === 'on';
  renderTranslate();
  void persist();
});
lang.addEventListener('change', () => void persist());
sourceLang.addEventListener('change', () => void updateSettings({ sourceLang: sourceLang.value }));
toggle.addEventListener('click', async () => {
  await persist();
  await send({ type: running ? 'popup-stop' : 'popup-start' });
});
$('settings').addEventListener('click', () => void chrome.runtime.openOptionsPage());
chrome.runtime.onMessage.addListener((message: Message) => {
  if (message.type === 'popup-status-update') render(message.status);
});
