import { TARGET_LANGUAGE_CODES, languageLabel } from '../shared/languages';

/** Fills a select with the translation languages, sorted by their name. */
export function fillTargetLanguages(select: HTMLSelectElement): void {
  const items = TARGET_LANGUAGE_CODES.map(code => ({ code, label: languageLabel(code) })).sort((a, b) => a.label.localeCompare(b.label));
  select.replaceChildren(...items.map(item => new Option(item.label, item.code)));
}
