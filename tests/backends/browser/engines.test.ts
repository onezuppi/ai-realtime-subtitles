import { describe, expect, it } from 'vitest';
import { ASR_ENGINES, MT_ENGINES, requiresDownload, sourceLanguageProblem } from '../../../src/backends/browser/engines';

describe('sourceLanguageProblem', () => {
  it('accepts auto for models that detect the language', () => {
    expect(sourceLanguageProblem(ASR_ENGINES['whisper-small'], 'auto')).toBeNull();
  });

  it('asks for a language when the model cannot detect it', () => {
    expect(sourceLanguageProblem(ASR_ENGINES.cohere, 'auto')).toMatch(/cannot detect the language/);
  });

  it('rejects a language the model does not support, accepts one it does', () => {
    expect(sourceLanguageProblem(ASR_ENGINES.cohere, 'ru')).toMatch(/does not support/);
    expect(sourceLanguageProblem(ASR_ENGINES.cohere, 'de')).toBeNull();
  });
});

describe('requiresDownload', () => {
  it('is false for "no translation"', () => {
    expect(requiresDownload(MT_ENGINES.none)).toBe(false);
    expect(requiresDownload(MT_ENGINES['plamo-0.8b'])).toBe(true);
  });
});
