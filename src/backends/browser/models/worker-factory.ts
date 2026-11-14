import type { WorkerLike } from '../browser-backend';

export function createModelWorker(): WorkerLike {
  return new Worker(new URL('../worker/index.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;
}

export const wasmBaseUrl = () => chrome.runtime.getURL('ort/');
