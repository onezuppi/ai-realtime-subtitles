import type { Progress } from '../../core/backend';
import type { AsrEngineId, MtEngineId } from './engines';

/** Messages between the page and the model worker. */
export type ToWorker =
  /** Loads the chosen models. A model that is not on the disk yet is downloaded first. */
  | { type: 'init'; asr: AsrEngineId | null; mt: MtEngineId | null; modelHost: string; wasmBase: string }
  | { type: 'transcribe'; id: number; samples: Float32Array; language: string }
  | { type: 'translate'; id: number; text: string; target: string };

export type FromWorker =
  | ({ type: 'progress' } & Progress)
  /** All files are on the disk and the model is in memory. */
  | { type: 'ready'; loadMs: number; device: string }
  | { type: 'result'; id: number; text: string; ms: number }
  | { type: 'error'; id?: number; message: string };
