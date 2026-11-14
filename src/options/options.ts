import { loadSettings, updateSettings, watchSettings } from '../shared/settings-store';
import { $ } from '../ui/dom';
import { mountBrowserModelsSection } from './browser-models-section';
import { mountCaptionSection } from './caption-section';
import type { OptionsContext } from './options-context';

let settings = await loadSettings();
const listeners: Array<() => void> = [];
const notify = () => listeners.forEach(listener => listener());

let timer: ReturnType<typeof setTimeout> | undefined;
const say = (text: string, ms = 1500) => {
  $('saved').textContent = text;
  clearTimeout(timer);
  timer = setTimeout(() => ($('saved').textContent = ''), ms);
};

const ctx: OptionsContext = {
  settings: () => settings,
  async update(patch) {
    settings = { ...settings, ...patch };
    notify();
    settings = await updateSettings(patch);
    say('Saved');
  },
  say,
  onChange: listener => void listeners.push(listener),
};

// Another page (the popup) can change the settings while this one is open.
watchSettings(next => {
  settings = next;
  notify();
});

mountCaptionSection(ctx);
const models = mountBrowserModelsSection(ctx);

// A download keeps running only while this page is open.
window.addEventListener('beforeunload', event => {
  if (models.isDownloading()) event.preventDefault();
});
