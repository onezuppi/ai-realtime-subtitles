import { post } from './post';

export interface ProgressEvent {
  status?: string;
  file?: string;
  loaded?: number;
  total?: number;
}

// Progress of all files of all models in one number.
const files = new Map<string, { loaded: number; total: number }>();

export function reportProgress(event: ProgressEvent) {
  if (event.status !== 'progress' || !event.file || !event.total) return;
  files.set(event.file, { loaded: event.loaded ?? 0, total: event.total });
  let loaded = 0;
  let total = 0;
  for (const part of files.values()) {
    loaded += part.loaded;
    total += part.total;
  }
  post({ type: 'progress', ratio: total ? loaded / total : 0, loadedBytes: loaded, totalBytes: total, file: event.file });
}
