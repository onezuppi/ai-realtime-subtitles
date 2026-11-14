import type { AsrEngine } from '../backends/browser/engines';

/** Source languages the settings offer. Cohere supports only some of them. */
export const SOURCE_LANGUAGES: { code: string; label: string }[] = [
  { code: 'auto', label: 'Detect automatically' },
  { code: 'zh', label: 'Chinese' },
  { code: 'es', label: 'Spanish' },
  { code: 'ja', label: 'Japanese' },
  { code: 'de', label: 'German' },
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'French' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'ko', label: 'Korean' },
  { code: 'ru', label: 'Russian' },
];

/** Languages PLaMo 3 Translate can write (52, from the model card). */
export const TARGET_LANGUAGE_CODES = [
  'ar', 'az', 'be', 'bg', 'bn', 'ca', 'ceb', 'de', 'en', 'es', 'et', 'eu', 'fa', 'fr', 'gu', 'he', 'hi', 'hr', 'hu', 'hy',
  'id', 'it', 'ja', 'jv', 'ka', 'kk', 'km', 'ko', 'lt', 'lv', 'ml', 'mr', 'ms', 'my', 'ne', 'nl', 'pa', 'pl', 'ru', 'si',
  'sk', 'sl', 'sr', 'sw', 'ta', 'te', 'th', 'tl', 'ur', 'uz', 'vi', 'zh',
];

/** "German (Deutsch)": the name in the interface language, then in the language itself. */
export function languageLabel(code: string, uiLocale = 'en'): string {
  try {
    const shown = new Intl.DisplayNames([uiLocale], { type: 'language' }).of(code);
    const own = new Intl.DisplayNames([code], { type: 'language' }).of(code);
    if (!shown) return code;
    return own && own.toLowerCase() !== shown.toLowerCase() ? `${shown} (${own})` : shown;
  } catch {
    return code;
  }
}

/** The audio languages a speech model offers. A model that cannot detect the language has no "auto" choice. */
export function sourceLanguageChoices(engine: AsrEngine): { code: string; label: string }[] {
  return SOURCE_LANGUAGES.filter(option => {
    if (option.code === 'auto') return !engine.needsLanguage;
    return !engine.sourceCodes || engine.sourceCodes.includes(option.code);
  });
}

/** Keeps the chosen language when the model accepts it, otherwise the first language it accepts. */
export function validSourceLanguage(engine: AsrEngine, current: string): string {
  const choices = sourceLanguageChoices(engine);
  if (choices.some(option => option.code === current)) return current;
  return choices.find(option => option.code === 'en')?.code ?? choices[0]?.code ?? 'auto';
}
