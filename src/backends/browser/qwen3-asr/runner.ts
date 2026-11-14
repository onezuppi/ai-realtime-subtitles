import type * as Ort from 'onnxruntime-web';
import { logMel } from './mel';
import { parseQwen3Output, TRANSCRIPT_TAG } from '../../../core/qwen3-asr-output';

/**
 * Qwen3-ASR 0.6B on three ONNX files: audio encoder, token embeddings and a merged decoder with a key-value cache.
 * Transformers.js has no runner for this model, so the generation loop lives here.
 * The code takes `ort` as an argument, so the same file runs in the browser (onnxruntime-web) and in Node tests.
 */

const AUDIO_PAD = 151676;
const EOS = new Set([151643, 151645]);
const LAYERS = 28;
const KV_HEADS = 8;
const HEAD_DIM = 128;
const HIDDEN = 1024;
const PROMPT_PREFIX = '<|im_start|>system\n<|im_end|>\n<|im_start|>user\n<|audio_start|>';
const PROMPT_SUFFIX = '<|audio_end|><|im_end|>\n<|im_start|>assistant\n';

/** Language names the model understands after "language ". */
export const QWEN3_LANGUAGES: Record<string, string> = {
  zh: 'Chinese', en: 'English', ar: 'Arabic', de: 'German', fr: 'French', es: 'Spanish', pt: 'Portuguese', id: 'Indonesian',
  it: 'Italian', ko: 'Korean', ru: 'Russian', th: 'Thai', vi: 'Vietnamese', ja: 'Japanese', tr: 'Turkish', hi: 'Hindi',
  ms: 'Malay', nl: 'Dutch', sv: 'Swedish', da: 'Danish', fi: 'Finnish', pl: 'Polish', cs: 'Czech', fa: 'Persian',
  el: 'Greek', ro: 'Romanian', hu: 'Hungarian',
};

export interface TokenizerLike {
  encode(text: string, options?: { add_special_tokens?: boolean }): number[];
  decode(ids: number[], options?: { skip_special_tokens?: boolean }): string;
}

export interface Qwen3Parts {
  ort: typeof Ort;
  encoder: Ort.InferenceSession;
  embed: Ort.InferenceSession;
  decoder: Ort.InferenceSession;
  tokenizer: TokenizerLike;
}

export interface Qwen3Result {
  /** Language the model reported, for example "English". Empty when it was forced. */
  language: string;
  text: string;
  audioTokens: number;
  generated: number;
}

const argmax = (values: Float32Array, offset: number, length: number) => {
  let best = 0;
  let bestValue = -Infinity;
  for (let i = 0; i < length; i++) {
    const value = values[offset + i]!;
    if (value > bestValue) {
      bestValue = value;
      best = i;
    }
  }
  return best;
};

export async function transcribeQwen3(
  parts: Qwen3Parts,
  samples: Float32Array,
  language: string | null,
  maxNewTokens = 200,
): Promise<Qwen3Result> {
  const { ort, encoder, embed, decoder, tokenizer } = parts;
  const { data, frames } = logMel(samples);
  if (frames < 10) return { language: '', text: '', audioTokens: 0, generated: 0 };

  // 1. Audio to features.
  const encoded = await encoder.run({ input_features: new ort.Tensor('float32', data, [1, 128, frames]) });
  const features = encoded.audio_features!;
  const audioTokens = features.dims[1]!;
  const featureData = features.data as Float32Array;

  // 2. The prompt, with one placeholder per audio token.
  const encode = (text: string) => tokenizer.encode(text, { add_special_tokens: false });
  const forced = language ? QWEN3_LANGUAGES[language] : undefined;
  const prompt = [
    ...encode(PROMPT_PREFIX),
    ...Array<number>(audioTokens).fill(AUDIO_PAD),
    ...encode(PROMPT_SUFFIX),
    ...(forced ? encode(`language ${forced}${TRANSCRIPT_TAG}`) : []),
  ];

  // 3. Token embeddings, with the audio features written over the placeholders.
  const idTensor = (ids: number[], shape: number[]) => new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), shape);
  const embedded = (await embed.run({ input_ids: idTensor(prompt, [1, prompt.length]) })).inputs_embeds!;
  const embeds = (embedded.data as Float32Array).slice();
  embedded.dispose?.();
  let next = 0;
  for (let i = 0; i < prompt.length && next < audioTokens; i++) {
    if (prompt[i] === AUDIO_PAD) embeds.set(featureData.subarray(next * HIDDEN, (next + 1) * HIDDEN), i * HIDDEN), next++;
  }
  features.dispose?.();

  // 4. Greedy generation with a key-value cache.
  const emptyPast = () => new ort.Tensor('float32', new Float32Array(0), [1, KV_HEADS, 0, HEAD_DIM]);
  let past: Record<string, Ort.Tensor> = {};
  for (let layer = 0; layer < LAYERS; layer++) {
    past[`past_key_values.${layer}.key`] = emptyPast();
    past[`past_key_values.${layer}.value`] = emptyPast();
  }
  const generated: number[] = [];
  let stepEmbeds = embeds;
  let stepLength = prompt.length;
  let total = 0;
  for (let step = 0; step < maxNewTokens; step++) {
    total += stepLength;
    const positions = Array.from({ length: stepLength }, (_, i) => total - stepLength + i);
    const feeds: Record<string, Ort.Tensor> = {
      inputs_embeds: new ort.Tensor('float32', stepEmbeds, [1, stepLength, HIDDEN]),
      attention_mask: idTensor(Array<number>(total).fill(1), [1, total]),
      position_ids: idTensor(positions, [1, stepLength]),
      ...past,
    };
    const out = await decoder.run(feeds);
    const logits = out.logits!;
    const vocab = logits.dims[2]!;
    const token = argmax(logits.data as Float32Array, (stepLength - 1) * vocab, vocab);
    logits.dispose?.();
    for (const tensor of Object.values(past)) tensor.dispose?.();
    past = {};
    for (let layer = 0; layer < LAYERS; layer++) {
      past[`past_key_values.${layer}.key`] = out[`present.${layer}.key`]!;
      past[`past_key_values.${layer}.value`] = out[`present.${layer}.value`]!;
    }
    if (EOS.has(token)) break;
    generated.push(token);
    const row = (await embed.run({ input_ids: idTensor([token], [1, 1]) })).inputs_embeds!;
    stepEmbeds = (row.data as Float32Array).slice();
    row.dispose?.();
    stepLength = 1;
  }
  for (const tensor of Object.values(past)) tensor.dispose?.();

  const raw = tokenizer.decode(generated, { skip_special_tokens: false });
  return { ...parseQwen3Output(raw, forced ?? null), audioTokens, generated: generated.length };
}
