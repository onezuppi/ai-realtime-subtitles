/** Qwen3-ASR answers "language English<asr_text>Hello". The same format comes from llama-server and from the browser runner. */

export const TRANSCRIPT_TAG = '<asr_text>';

export interface Qwen3Output {
  /** Lower-case language name as the model wrote it, or "" when there is none. */
  language: string;
  text: string;
}

const clean = (value: string) => value.replace(/<\|[^|>]*\|>/g, '').trim();

/** `forcedLanguage` is set when the prompt already named the language: the answer then holds only the text. */
export function parseQwen3Output(raw: string, forcedLanguage: string | null = null): Qwen3Output {
  const at = raw.indexOf(TRANSCRIPT_TAG);
  if (forcedLanguage || at === -1) return { language: '', text: clean(at === -1 ? raw : raw.slice(at + TRANSCRIPT_TAG.length)) };
  const language = /^language\s+(.*)$/im.exec(clean(raw.slice(0, at)))?.[1]?.trim().toLowerCase() ?? '';
  return { language: language === 'none' ? '' : language, text: clean(raw.slice(at + TRANSCRIPT_TAG.length)) };
}
