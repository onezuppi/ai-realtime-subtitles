/**
 * The few Transformers.js shapes the worker uses, typed by hand: the library types its pipelines too loosely.
 * Each loader casts to these once, so the rest of the worker has no casts.
 */

/** Speech to text for one phrase. `language` is a code, or "auto". */
export type Transcriber = (samples: Float32Array, language: string) => Promise<string>;

export interface GenerateOutput {
  tolist(): number[][];
}

export interface AsrPipeline {
  (audio: Float32Array, options: Record<string, unknown>): Promise<{ text?: string } | { text?: string }[]>;
  processor(audio: Float32Array): Promise<Record<string, unknown>>;
  tokenizer: { decode(ids: number[], options: unknown): string };
  model: { generate(options: unknown): Promise<GenerateOutput> };
}

export interface ChatTokenizer {
  (text: string, options: unknown): { input_ids: { dims: number[] } };
  apply_chat_template(messages: unknown, options: unknown): string;
  decode(ids: number[], options: unknown): string;
}

export interface CausalModel {
  generate(options: unknown): Promise<GenerateOutput>;
}
