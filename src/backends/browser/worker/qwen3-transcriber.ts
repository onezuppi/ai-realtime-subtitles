import type { AsrEngine } from '../engines';
import { loadQwen3 } from '../qwen3-asr/load';
import { transcribeQwen3 } from '../qwen3-asr/runner';
import { asrTokenCap } from './asr-limits';
import { reportProgress } from './progress';
import type { Device } from './runtime-env';
import type { Transcriber } from './transformers-types';

/** Qwen3-ASR runs on its own runner, because Transformers.js cannot run this model. */
export async function loadQwen3Transcriber(engine: AsrEngine, modelHost: string, wasmBase: string, device: Device): Promise<Transcriber> {
  const parts = await loadQwen3(engine.repo, modelHost, wasmBase, device === 'webgpu', (file, loaded, total) =>
    reportProgress({ status: 'progress', file, loaded, total }),
  );
  return async (samples, language) => (await transcribeQwen3(parts, samples, language === 'auto' ? null : language, asrTokenCap(samples))).text;
}
