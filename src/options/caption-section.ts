import { OVERLAY_BOX_KEY } from '../shared/storage-keys';
import { $ } from '../ui/dom';
import { fillTargetLanguages } from '../ui/target-languages';
import type { OptionsContext } from './options-context';

const PREVIEW_BASE_PX = 18;

/** Opacity, text size and language of the captions, with a live preview. */
export function mountCaptionSection(ctx: OptionsContext): void {
  const opacity = $<HTMLInputElement>('opacity');
  const fontScale = $<HTMLInputElement>('fontScale');
  const lang = $<HTMLSelectElement>('lang');
  const preview = $<HTMLDivElement>('preview');
  const translateBox = $<HTMLDivElement>('translate-mode');
  fillTargetLanguages(lang);

  const render = () => {
    const settings = ctx.settings();
    opacity.value = String(settings.opacity);
    fontScale.value = String(settings.fontScale);
    lang.value = settings.targetLang;
    for (const button of translateBox.querySelectorAll<HTMLButtonElement>('button')) {
      button.setAttribute('aria-checked', String((button.dataset.value === 'on') === settings.translate));
    }
    $('target-row').hidden = !settings.translate;
    $('opacity-value').textContent = `${Math.round(settings.opacity * 100)}%`;
    $('fontScale-value').textContent = `${Math.round(settings.fontScale * 100)}%`;
    preview.style.background = `rgba(0, 0, 0, ${settings.opacity})`;
    preview.style.fontSize = `${Math.round(PREVIEW_BASE_PX * settings.fontScale)}px`;
  };

  opacity.addEventListener('input', () => void ctx.update({ opacity: Number(opacity.value) }));
  fontScale.addEventListener('input', () => void ctx.update({ fontScale: Number(fontScale.value) }));
  translateBox.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest('button');
    if (button) void ctx.update({ translate: button.dataset.value === 'on' });
  });
  lang.addEventListener('change', () => void ctx.update({ targetLang: lang.value }));
  $('reset-position').addEventListener('click', async () => {
    await chrome.storage.local.remove(OVERLAY_BOX_KEY);
    ctx.say('Position and size reset', 3000);
  });
  ctx.onChange(render);
  render();
}
