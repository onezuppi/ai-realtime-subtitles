import { DOWNLOADED_MODELS_KEY, MODEL_CACHE_NAME } from '../../../shared/storage-keys';
import { ASR_ENGINES, MT_ENGINES, type AsrEngineId, type MtEngineId } from '../engines';

/** Which browser models are downloaded. Files live in the Cache API of the extension origin. */

export type ModelRef = { kind: 'asr'; id: AsrEngineId } | { kind: 'mt'; id: MtEngineId };

/** `files` lists the cached URLs at the time the download finished; older records have none. */
type Downloaded = Record<string, { bytes: number; at: number; files?: string[] }>;

export const engineOf = (ref: ModelRef) => (ref.kind === 'asr' ? ASR_ENGINES[ref.id] : MT_ENGINES[ref.id]);
export const repoOf = (ref: ModelRef): string => engineOf(ref).repo;
export const keyOf = (ref: ModelRef) => `${ref.kind}:${ref.id}`;

export const readDownloaded = async (): Promise<Downloaded> =>
  ((await chrome.storage.local.get(DOWNLOADED_MODELS_KEY))[DOWNLOADED_MODELS_KEY] as Downloaded | undefined) ?? {};

const cachedUrls = async (repo: string): Promise<string[]> => {
  const cache = await caches.open(MODEL_CACHE_NAME);
  return (await cache.keys()).map(request => request.url).filter(url => url.includes(`/${repo}/`));
};

export const markDownloaded = async (ref: ModelRef, bytes: number): Promise<void> => {
  const downloaded = await readDownloaded();
  const repo = repoOf(ref);
  const files = repo ? await cachedUrls(repo).catch(() => undefined) : undefined;
  await chrome.storage.local.set({ [DOWNLOADED_MODELS_KEY]: { ...downloaded, [keyOf(ref)]: { bytes, at: Date.now(), files } } });
};

/** True when a finished download is recorded and every file of it is still in the cache (no network is used). */
export async function isDownloaded(ref: ModelRef): Promise<boolean> {
  const record = (await readDownloaded())[keyOf(ref)];
  if (!record) return false;
  const repo = repoOf(ref);
  if (!repo) return true;
  try {
    const present = new Set(await cachedUrls(repo));
    return record.files?.length ? record.files.every(url => present.has(url)) : present.size > 0;
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
