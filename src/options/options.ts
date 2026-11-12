import { OVERLAY_BOX_KEY } from '../content/geometry';
import { loadSettings, saveSettings, type Settings } from '../messages';

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
