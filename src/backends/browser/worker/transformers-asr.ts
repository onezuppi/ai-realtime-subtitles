import { pipeline } from '@huggingface/transformers';
import { WHISPER_LANGUAGES, type AsrEngine } from '../engines';
import { asrTokenCap } from './asr-limits';
import { reportProgress } from './progress';
import type { Device } from './runtime-env';
import type { AsrPipeline, Transcriber } from './transformers-types';
import { detectWhisperLanguage } from './whisper-language';

/** Whisper and Cohere run as Transformers.js pipelines. */
export async function loadPipelineAsr(engine: AsrEngine, device: Device): Promise<Transcriber> {
  const pipe = (await pipeline('automatic-speech-recognition', engine.repo, {
    // The Whisper encoder in fp32 is the only part that has no smaller file; Cohere runs in q4f16 on WebGPU only.
    dtype: engine.dtype as never,
    device,
    progress_callback: reportProgress,
  })) as unknown as AsrPipeline;
  const isWhisper = engine.id === 'whisper-small';

  return async (samples, language) => {
    if (isWhisper && language === 'auto') language = (await detectWhisperLanguage(pipe, samples)) ?? 'auto';
    // The token cap and the repeat block stop Whisper from looping on noise and on Chinese.
    const options: Record<string, unknown> = { max_new_tokens: asrTokenCap(samples) };
    if (isWhisper) {
      options.no_repeat_ngram_size = 4;
      options.task = 'transcribe';
    }
    if (language !== 'auto') options.language = isWhisper ? (WHISPER_LANGUAGES[language] ?? language) : language;
    const result = await pipe(samples, options);
    return (Array.isArray(result) ? result[0]?.text : result.text)?.trim() ?? '';
  };
}
