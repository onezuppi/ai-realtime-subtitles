import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isDownloaded, markDownloaded, type ModelRef } from '../../../src/backends/browser/models/model-store';
import { ASR_ENGINES } from '../../../src/backends/browser/engines';

const ref: ModelRef = { kind: 'asr', id: Object.keys(ASR_ENGINES).find(id => ASR_ENGINES[id as keyof typeof ASR_ENGINES].repo) as never };
const repo = ASR_ENGINES[ref.id as keyof typeof ASR_ENGINES].repo;

describe('model-store', () => {
  let stored: Record<string, unknown>;
  let cached: string[];

  beforeEach(() => {
    stored = {};
    cached = [`https://host/${repo}/a.onnx`, `https://host/${repo}/b.onnx`];
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: async (key: string) => ({ [key]: stored[key] }),
          set: async (items: Record<string, unknown>) => Object.assign(stored, items),
        },
      },
    });
    vi.stubGlobal('caches', { open: async () => ({ keys: async () => cached.map(url => ({ url })) }) });
  });

  it('is downloaded while every recorded file is cached', async () => {
    await markDownloaded(ref, 10);
    expect(await isDownloaded(ref)).toBe(true);
  });

  it('is not downloaded when one of the files is gone', async () => {
    await markDownloaded(ref, 10);
    cached = cached.slice(0, 1);
    expect(await isDownloaded(ref)).toBe(false);
  });

  it('is not downloaded without a record', async () => {
    expect(await isDownloaded(ref)).toBe(false);
  });
});
