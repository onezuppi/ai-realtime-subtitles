import { ASR_ENGINES, MT_ENGINES, sourceLanguageProblem, type AsrEngineId, type MtEngineId } from '../backends/browser/engines';
import { sourceLanguageChoices, validSourceLanguage } from '../shared/languages';
import { DEFAULT_SETTINGS } from '../shared/settings';
import { $ } from '../ui/dom';
import { createModelRow, type ModelRow } from './model-row';
import type { OptionsContext } from './options-context';

const HINT_AUTO = 'Automatic detection works for this model. Choose a language only if it guesses wrong.';

/** Models of the Browser mode: source language, download host and one row per model. */
export function mountBrowserModelsSection(ctx: OptionsContext): { isDownloading(): boolean } {
  const sourceLang = $<HTMLSelectElement>('sourceLang');
  const modelHost = $<HTMLInputElement>('modelHost');
  const rows: ModelRow[] = [];

  $('gpu-warning').hidden = 'gpu' in navigator;

  const updateHint = () => {
    const { asrEngine, sourceLang: language } = ctx.settings();
    const engine = ASR_ENGINES[asrEngine];
    const needsChoice = `${engine.label} cannot detect the language, so you must choose the language of the audio. Subtitles will not start without it.`;
    const hint = $('source-hint');
    hint.textContent = sourceLanguageProblem(engine, language) ?? (engine.needsLanguage ? needsChoice : HINT_AUTO);
    hint.dataset.required = String(engine.needsLanguage);
    $('source-label').textContent = engine.needsLanguage ? 'Language of the audio (required for this model)' : 'Language of the audio';
  };
  const render = () => {
    const engine = ASR_ENGINES[ctx.settings().asrEngine];
    sourceLang.replaceChildren(...sourceLanguageChoices(engine).map(option => new Option(option.label, option.code)));
    // A model that cannot detect the language needs a real choice, so a stale "auto" is replaced right away.
    const valid = validSourceLanguage(engine, ctx.settings().sourceLang);
    if (valid !== ctx.settings().sourceLang) void ctx.update({ sourceLang: valid });
    sourceLang.value = valid;
    modelHost.value = ctx.settings().modelHost;
    updateHint();
    for (const row of rows) void row.refresh();
  };

  sourceLang.addEventListener('change', () => void ctx.update({ sourceLang: sourceLang.value }));
  modelHost.addEventListener('change', () => void ctx.update({ modelHost: modelHost.value.trim() || DEFAULT_SETTINGS.modelHost }));

  for (const id of Object.keys(ASR_ENGINES) as AsrEngineId[]) rows.push(createModelRow($('asr-models'), { kind: 'asr', id }, ctx, render));
  // "No translation" is the Subtitles switch in the Translation card, not a model to pick.
  for (const id of (Object.keys(MT_ENGINES) as MtEngineId[]).filter(id => id !== 'none')) rows.push(createModelRow($('mt-models'), { kind: 'mt', id }, ctx, render));
  ctx.onChange(render);
  render();
  return { isDownloading: () => rows.some(row => row.isDownloading()) };
}
