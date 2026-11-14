import { describe, expect, it } from 'vitest';
import { audioTokenCount, logMel, melFilterBank, N_MELS } from '../src/backends/browser/qwen3-asr/mel';
import { parseOutput } from '../src/backends/browser/qwen3-asr/runner';

describe('Qwen3-ASR features', () => {
  it('counts audio tokens like the model does', () => {
    expect(audioTokenCount(600)).toBe(78); // checked against the encoder output of a 6 s clip
    expect(audioTokenCount(0)).toBe(0);
    expect(audioTokenCount(50)).toBe(7);
  });

  it('builds 128 triangular filters that are never negative', () => {
    const bank = melFilterBank();
    expect(bank).toHaveLength(N_MELS);
    expect(bank.every(row => row.every(value => value >= 0))).toBe(true);
  });

  it('gives one frame per 160 samples and keeps values in the clamped range', () => {
    const samples = Float32Array.from({ length: 16000 }, (_, i) => Math.sin(i / 20));
    const { data, frames } = logMel(samples);
    expect(frames).toBe(100);
    expect(data).toHaveLength(N_MELS * frames);
    const max = Math.max(...data);
    const min = Math.min(...data);
    expect(max - min).toBeLessThanOrEqual(2 + 1e-6); // log range of 8 divided by 4
  });
});

describe('parseOutput', () => {
  it('splits the language and the text', () => {
    expect(parseOutput('language English<asr_text>Hello there.<|im_end|>', null)).toEqual({ language: 'English', text: 'Hello there.' });
  });

  it('returns only the text when the language was forced', () => {
    expect(parseOutput('Hello there.', 'English')).toEqual({ language: '', text: 'Hello there.' });
  });

  it('treats "language None" as no language', () => {
    expect(parseOutput('language None<asr_text>', null)).toEqual({ language: '', text: '' });
  });
});
