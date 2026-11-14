import { describe, expect, it } from 'vitest';
import { ASR_ENGINES } from '../../src/backends/browser/engines';
import { TARGET_LANGUAGE_CODES, languageLabel, sourceLanguageChoices, validSourceLanguage } from '../../src/shared/languages';
import { DEFAULT_SETTINGS, effectiveMtEngine, normalizeSettings } from '../../src/shared/settings';

describe('translation mode', () => {
  it('translates by default and keeps a stored choice', () => {
    expect(normalizeSettings({}).translate).toBe(true);
    expect(normalizeSettings({ translate: false }).translate).toBe(false);
    expect(normalizeSettings({ translate: 'no' }).translate).toBe(DEFAULT_SETTINGS.translate);
  });

  it('runs no translation model for plain subtitles', () => {
    expect(effectiveMtEngine({ ...DEFAULT_SETTINGS, translate: false })).toBe('none');
    expect(effectiveMtEngine({ ...DEFAULT_SETTINGS, translate: true })).toBe(DEFAULT_SETTINGS.mtEngine);
  });

  it('offers the 52 languages of the model, each once', () => {
    expect(TARGET_LANGUAGE_CODES).toHaveLength(52);
    expect(new Set(TARGET_LANGUAGE_CODES).size).toBe(52);
  });

  it('shows the name in the interface language and in the language itself', () => {
    expect(languageLabel('de')).toBe('German (Deutsch)');
    expect(languageLabel('en')).toBe('English');
  });
});

describe('audio language choices', () => {
  const cohere = ASR_ENGINES.cohere;
  const whisper = ASR_ENGINES['whisper-small'];

  it('has no "auto" for a model that cannot detect the language, and only languages it knows', () => {
    const codes = sourceLanguageChoices(cohere).map(option => option.code);
    expect(codes).not.toContain('auto');
    expect(codes).not.toContain('ru');
    expect(codes).toContain('de');
  });

  it('offers "auto" for a model that detects the language', () => {
    expect(sourceLanguageChoices(whisper).map(option => option.code)).toContain('auto');
  });

  it('replaces an unusable choice with English, or the first language', () => {
    expect(validSourceLanguage(cohere, 'auto')).toBe('en');
    expect(validSourceLanguage(cohere, 'ru')).toBe('en');
    expect(validSourceLanguage(cohere, 'de')).toBe('de');
  });
});
