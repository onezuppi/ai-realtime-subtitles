import { ASR_ENGINES, MT_ENGINES, SOURCE_LANGUAGES } from '../backends/browser/engines';
import { downloadedBytes, downloadModel, formatBytes, isDownloaded, removeModel, type ModelRef } from '../backends/browser/models';
import { OVERLAY_BOX_KEY } from '../content/geometry';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from '../messages';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const opacity = $<HTMLInputElement>('opacity');
const fontScale = $<HTMLInputElement>('fontScale');
const lang = $<HTMLSelectElement>('lang');
const preview = $<HTMLDivElement>('preview');
const saved = $<HTMLDivElement>('saved');

let settings: Settings = await loadSettings();
let timer: ReturnType<typeof setTimeout> | undefined;

function render() {
  opacity.value = String(settings.opacity);
  fontScale.value = String(settings.fontScale);
  lang.value = settings.targetLang;
  $('opacity-value').textContent = `${Math.round(settings.opacity * 100)}%`;
  $('fontScale-value').textContent = `${Math.round(settings.fontScale * 100)}%`;
  preview.style.background = `rgba(0, 0, 0, ${settings.opacity})`;
  preview.style.fontSize = `${Math.round(18 * settings.fontScale)}px`;
}

async function update(patch: Partial<Settings>) {
  settings = { ...settings, ...patch };
  render();
  await saveSettings(settings);
  saved.textContent = 'Saved';
  clearTimeout(timer);
  timer = setTimeout(() => (saved.textContent = ''), 1500);
}

opacity.addEventListener('input', () => void update({ opacity: Number(opacity.value) }));
fontScale.addEventListener('input', () => void update({ fontScale: Number(fontScale.value) }));
lang.addEventListener('change', () => void update({ targetLang: lang.value }));
$('reset-position').addEventListener('click', async () => {
  await chrome.storage.local.remove(OVERLAY_BOX_KEY);
  saved.textContent = 'Position and size reset';
});
render();

// ---- Models of the Browser mode ----

const hasGpu = 'gpu' in navigator;
const needsGpu = (ref: ModelRef) => !(ref.kind === 'asr' && ref.id === 'whisper-small') && !(ref.kind === 'mt' && ref.id === 'none');
$('gpu-warning').hidden = hasGpu;

const sourceLang = $<HTMLSelectElement>('sourceLang');
const modelHost = $<HTMLInputElement>('modelHost');
for (const option of SOURCE_LANGUAGES) sourceLang.add(new Option(option.label, option.code));
sourceLang.value = settings.sourceLang;
modelHost.value = settings.modelHost;
sourceLang.addEventListener('change', () => void update({ sourceLang: sourceLang.value }));
modelHost.addEventListener('change', () => void update({ modelHost: modelHost.value.trim() || DEFAULT_SETTINGS.modelHost }));

interface Row {
  ref: ModelRef;
  root: HTMLElement;
  status: HTMLElement;
  bar: HTMLElement;
  fill: HTMLElement;
  download: HTMLButtonElement;
  cancel: HTMLButtonElement;
  remove: HTMLButtonElement;
  radio: HTMLInputElement;
  controller?: AbortController;
}
const rows: Row[] = [];

const engineOf = (ref: ModelRef) => (ref.kind === 'asr' ? ASR_ENGINES[ref.id] : MT_ENGINES[ref.id]);

function setStatus(row: Row, text: string, kind: 'info' | 'ok' | 'error' = 'info') {
  row.status.textContent = text;
  row.status.dataset.kind = kind;
}

async function refreshRow(row: Row) {
  const downloading = Boolean(row.controller);
  const ready = await isDownloaded(row.ref);
  const available = row.ref.kind === 'asr' ? ASR_ENGINES[row.ref.id].available : MT_ENGINES[row.ref.id].available;
  const noDownload = row.ref.kind === 'mt' && row.ref.id === 'none';
  row.download.hidden = noDownload || ready || downloading || !available;
  row.cancel.hidden = !downloading;
  row.remove.hidden = noDownload || !ready || downloading;
  row.bar.hidden = !downloading;
  row.radio.disabled = !available || (!ready && !noDownload);
  const selected = settings[row.ref.kind === 'asr' ? 'asrEngine' : 'mtEngine'] === row.ref.id;
  row.root.dataset.selected = String(selected);
  row.radio.checked = selected;
  if (downloading) return;
  if (!available) setStatus(row, 'Not available yet');
  else if (noDownload) setStatus(row, '');
  else if (ready) {
    const bytes = await downloadedBytes(row.ref);
    setStatus(row, `Ready${bytes ? `, ${formatBytes(bytes)} on disk` : ''}. Works offline.`, 'ok');
  } else if (needsGpu(row.ref) && !hasGpu) setStatus(row, 'Needs WebGPU, which this browser does not have', 'error');
  else setStatus(row, 'Not downloaded');
}

async function startDownload(row: Row) {
  const controller = new AbortController();
  row.controller = controller;
  setStatus(row, 'Starting the download...');
  row.fill.style.width = '0%';
  await refreshRow(row);
  const started = performance.now();
  try {
    await downloadModel(
      row.ref,
      settings.modelHost,
      progress => {
        // Small files arrive first and would show 100% too early, so measure against the known model size.
        const expected = Math.max(progress.totalBytes, engineOf(row.ref).sizeMB * 1e6);
        const ratio = Math.min(progress.loadedBytes / expected, 1);
        row.fill.style.width = `${Math.round(ratio * 100)}%`;
        const seconds = (performance.now() - started) / 1000;
        const speed = seconds > 1 ? ` at ${(progress.loadedBytes / 1e6 / seconds).toFixed(1)} MB/s` : '';
        setStatus(row, `${Math.round(ratio * 100)}%, ${formatBytes(progress.loadedBytes)} of ${formatBytes(expected)}${speed}`);
      },
      controller.signal,
    );
    row.controller = undefined;
  } catch (error) {
    row.controller = undefined;
    const cancelled = error instanceof DOMException && error.name === 'AbortError';
    await refreshRow(row);
    setStatus(row, cancelled ? 'Cancelled. Press Download to continue where it stopped.' : `Download failed: ${error instanceof Error ? error.message : String(error)}`, cancelled ? 'info' : 'error');
    return;
  }
  await refreshRow(row);
}

function addRow(container: HTMLElement, ref: ModelRef) {
  const engine = ref.kind === 'asr' ? ASR_ENGINES[ref.id] : MT_ENGINES[ref.id];
  const root = document.createElement('div');
  root.className = 'model';
  root.innerHTML = `
    <div class="model-head">
      <label><input type="radio" name="${ref.kind}-engine" /><span class="name"></span></label>
      <div class="model-actions">
        <button class="btn btn-primary download" type="button">Download</button>
        <button class="btn cancel" type="button" hidden>Cancel</button>
        <button class="btn remove" type="button" hidden>Remove</button>
      </div>
    </div>
    <div class="model-meta"></div>
    <div class="bar" hidden><div></div></div>
    <div class="model-status" role="status"></div>`;
  const size = engine.sizeMB >= 1000 ? `${(engine.sizeMB / 1000).toFixed(1)} GB` : `${engine.sizeMB} MB`;
  (root.querySelector('.name') as HTMLElement).textContent = engine.sizeMB ? `${engine.label}  ·  ${size}` : engine.label;
  (root.querySelector('.model-meta') as HTMLElement).textContent = `${engine.languages}. ${engine.note}`;
  const row: Row = {
    ref,
    root,
    status: root.querySelector('.model-status') as HTMLElement,
    bar: root.querySelector('.bar') as HTMLElement,
    fill: root.querySelector('.bar > div') as HTMLElement,
    download: root.querySelector('.download') as HTMLButtonElement,
    cancel: root.querySelector('.cancel') as HTMLButtonElement,
    remove: root.querySelector('.remove') as HTMLButtonElement,
    radio: root.querySelector('input') as HTMLInputElement,
  };
  row.download.addEventListener('click', () => void startDownload(row));
  row.cancel.addEventListener('click', () => row.controller?.abort());
  row.remove.addEventListener('click', async () => {
    await removeModel(ref);
    await refreshRow(row);
  });
  row.radio.addEventListener('change', async () => {
    await update(ref.kind === 'asr' ? { asrEngine: ref.id as Settings['asrEngine'] } : { mtEngine: ref.id as Settings['mtEngine'] });
    await Promise.all(rows.filter(other => other.ref.kind === ref.kind).map(refreshRow));
    updateSourceHint();
  });
  rows.push(row);
  container.append(root);
  void refreshRow(row);
}

function updateSourceHint() {
  const engine = ASR_ENGINES[settings.asrEngine];
  $('source-hint').textContent = engine.needsLanguage
    ? `${engine.label} cannot detect the language. Choose the language of the audio.`
    : 'Automatic detection works for this model. Choose a language only if it guesses wrong.';
}

for (const id of Object.keys(ASR_ENGINES) as (keyof typeof ASR_ENGINES)[]) addRow($('asr-models'), { kind: 'asr', id });
for (const id of Object.keys(MT_ENGINES) as (keyof typeof MT_ENGINES)[]) addRow($('mt-models'), { kind: 'mt', id });
updateSourceHint();

// A download keeps running only while this page is open.
window.addEventListener('beforeunload', event => {
  if (rows.some(row => row.controller)) event.preventDefault();
});
