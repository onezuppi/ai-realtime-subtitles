import { ASR_ENGINES, MT_ENGINES, type AsrEngineId, type MtEngineId } from './engines';
import type { Progress } from '../../core/backend';
import type { FromWorker, ToWorker } from './protocol';
import type { WorkerLike } from './browser-backend';

/** Downloading, checking and removing browser models. Models live in the Cache API of the extension origin. */

export type ModelRef = { kind: 'asr'; id: AsrEngineId } | { kind: 'mt'; id: MtEngineId };

const STORAGE_KEY = 'downloadedModels';
const CACHE_NAME = 'transformers-cache';
export const DEFAULT_MODEL_HOST = 'https://huggingface.co';

export const repoOf = (ref: ModelRef): string => (ref.kind === 'asr' ? ASR_ENGINES[ref.id].repo : MT_ENGINES[ref.id].repo);
const keyOf = (ref: ModelRef) => `${ref.kind}:${ref.id}`;

export function createModelWorker(): WorkerLike {
  return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;
}

export const wasmBaseUrl = () => chrome.runtime.getURL('ort/');

type Downloaded = Record<string, { bytes: number; at: number }>;
const readDownloaded = async (): Promise<Downloaded> => ((await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] as Downloaded | undefined) ?? {};

/** True when a finished download is recorded and the files are still in the cache. */
export async function isDownloaded(ref: ModelRef): Promise<boolean> {
  if (!(keyOf(ref) in (await readDownloaded()))) return false;
  const repo = repoOf(ref);
  if (!repo) return true;
  try {
    const cache = await caches.open(CACHE_NAME);
    return (await cache.keys()).some(request => request.url.includes(`/${repo}/`));
  } catch {
    return false;
  }
}

export async function downloadedBytes(ref: ModelRef): Promise<number | undefined> {
  return (await readDownloaded())[keyOf(ref)]?.bytes;
}

/**
 * Downloads one model and loads it once, so a broken download shows up now and not during the first caption.
 * `signal` stops the download; the files that arrived stay in the cache and the next try continues quickly.
 */
export function downloadModel(
  ref: ModelRef,
  modelHost: string,
  onProgress: (progress: Progress) => void,
  signal?: AbortSignal,
  createWorker: () => WorkerLike = createModelWorker,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const worker = createWorker();
    let totalBytes = 0;
    const finish = (action: () => void) => {
      worker.terminate();
      signal?.removeEventListener('abort', onAbort);
      action();
    };
    const onAbort = () => finish(() => reject(new DOMException('Download cancelled', 'AbortError')));
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort);

    worker.onmessage = (event: MessageEvent<FromWorker>) => {
      const message = event.data;
      if (message.type === 'progress') {
        totalBytes = message.totalBytes;
        onProgress(message);
      } else if (message.type === 'error') {
        finish(() => reject(new Error(message.message)));
      } else if (message.type === 'ready') {
        void readDownloaded().then(async downloaded => {
          await chrome.storage.local.set({ [STORAGE_KEY]: { ...downloaded, [keyOf(ref)]: { bytes: totalBytes, at: Date.now() } } });
          finish(resolve);
        });
      }
    };
    worker.onerror = event => finish(() => reject(new Error(event.message || 'The download worker crashed')));
    const init: ToWorker = {
      type: 'init',
      asr: ref.kind === 'asr' ? ref.id : null,
      mt: ref.kind === 'mt' ? ref.id : null,
      modelHost,
      wasmBase: wasmBaseUrl(),
    };
    worker.postMessage(init);
  });
}

/** Deletes the files of one model from the cache. */
export async function removeModel(ref: ModelRef): Promise<void> {
  const repo = repoOf(ref);
  const cache = await caches.open(CACHE_NAME);
  for (const request of await cache.keys()) {
    if (request.url.includes(`/${repo}/`)) await cache.delete(request);
  }
  const downloaded = await readDownloaded();
  delete downloaded[keyOf(ref)];
  await chrome.storage.local.set({ [STORAGE_KEY]: downloaded });
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  return `${Math.round(bytes / 1e6)} MB`;
}
