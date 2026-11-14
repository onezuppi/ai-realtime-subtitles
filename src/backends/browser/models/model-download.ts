import type { Progress } from '../../../core/backend';
import type { WorkerLike } from '../browser-backend';
import type { FromWorker, ToWorker } from '../protocol';
import { markDownloaded, type ModelRef } from './model-store';
import { createModelWorker, wasmBaseUrl } from './worker-factory';

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
        markDownloaded(ref, totalBytes).then(
          () => finish(resolve),
          error => finish(() => reject(error)),
        );
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
