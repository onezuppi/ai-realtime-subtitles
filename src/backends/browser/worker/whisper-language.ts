import { Tensor } from '@huggingface/transformers';
import type { AsrPipeline } from './transformers-types';

// Whisper token ids of the multilingual models: <|startoftranscript|> and the first and last language token.
const WHISPER_SOT = 50258;
const WHISPER_FIRST_LANGUAGE = 50259;
const WHISPER_LAST_LANGUAGE = 50357;

/** Transformers.js does not detect the language and falls back to English, so the first decoder step is run here. */
export async function detectWhisperLanguage(pipe: AsrPipeline, samples: Float32Array): Promise<string | null> {
  const inputs = await pipe.processor(samples);
  const decoderInputIds = new Tensor('int64', BigInt64Array.from([BigInt(WHISPER_SOT)]), [1, 1]);
  const out = await pipe.model.generate({ ...inputs, decoder_input_ids: decoderInputIds, max_new_tokens: 2 });
  const token = Number((out.tolist()[0] ?? [])[1]);
  if (!(token >= WHISPER_FIRST_LANGUAGE && token <= WHISPER_LAST_LANGUAGE)) return null;
  return pipe.tokenizer.decode([token], { skip_special_tokens: false }).replace(/[<|>]/g, '') || null;
}
