import { DOWNLOADED_MODELS_KEY, MODEL_CACHE_NAME } from '../../../shared/storage-keys';
import { ASR_ENGINES, MT_ENGINES, type AsrEngineId, type MtEngineId } from '../engines';

/** Which browser models are downloaded. Files live in the Cache API of the extension origin. */

export type ModelRef = { kind: 'asr'; id: AsrEngineId } | { kind: 'mt'; id: MtEngineId };

type Downloaded = Record<string, { bytes: number; at: number }>;

export const engineOf = (ref: ModelRef) => (ref.kind === 'asr' ? ASR_ENGINES[ref.id] : MT_ENGINES[ref.id]);
export const repoOf = (ref: ModelRef): string => engineOf(ref).repo;
export const keyOf = (ref: ModelRef) => `${ref.kind}:${ref.id}`;

export const readDownloaded = async (): Promise<Downloaded> =>
  ((await chrome.storage.local.get(DOWNLOADED_MODELS_KEY))[DOWNLOADED_MODELS_KEY] as Downloaded | undefined) ?? {};

export const markDownloaded = async (ref: ModelRef, bytes: number): Promise<void> => {
  const downloaded = await readDownloaded();
  await chrome.storage.local.set({ [DOWNLOADED_MODELS_KEY]: { ...downloaded, [keyOf(ref)]: { bytes, at: Date.now() } } });
};

/** True when a finished download is recorded and the files are still in the cache. */
export async function isDownloaded(ref: ModelRef): Promise<boolean> {
  if (!(keyOf(ref) in (await readDownloaded()))) return false;
  const repo = repoOf(ref);
  if (!repo) return true;
  try {
    const cache = await caches.open(MODEL_CACHE_NAME);
    return (await cache.keys()).some(request => request.url.includes(`/${repo}/`));
  } catch {
    return false;
  }
}

export async function downloadedBytes(ref: ModelRef): Promise<number | undefined> {
  return (await readDownloaded())[keyOf(ref)]?.bytes;
}

/** Deletes the files of one model from the cache. */
export async function removeModel(ref: ModelRef): Promise<void> {
  const repo = repoOf(ref);
  // An empty repository matches every cached URL, so there is nothing to remove for a model without files.
  if (!repo) return;
  const cache = await caches.open(MODEL_CACHE_NAME);
  for (const request of await cache.keys()) {
    if (request.url.includes(`/${repo}/`)) await cache.delete(request);
  }
  const downloaded = await readDownloaded();
  delete downloaded[keyOf(ref)];
  await chrome.storage.local.set({ [DOWNLOADED_MODELS_KEY]: downloaded });
}
