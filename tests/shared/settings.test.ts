import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings } from '../../src/shared/settings';

describe('normalizeSettings', () => {
  it('returns the defaults for nothing or for junk', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings('text')).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid stored values and fills the rest', () => {
    const settings = normalizeSettings({ mode: 'browser', targetLang: 'ru', opacity: 0.8 });
    expect(settings).toMatchObject({ mode: 'browser', targetLang: 'ru', opacity: 0.8, fontScale: DEFAULT_SETTINGS.fontScale });
  });

  it('replaces unknown engines and modes with the defaults', () => {
    const settings = normalizeSettings({ mode: 'cloud', asrEngine: 'removed-engine', mtEngine: 'gone' });
    expect(settings.mode).toBe(DEFAULT_SETTINGS.mode);
    expect(settings.asrEngine).toBe(DEFAULT_SETTINGS.asrEngine);
    expect(settings.mtEngine).toBe(DEFAULT_SETTINGS.mtEngine);
  });

  it('clamps numbers to their range and rejects non-numbers', () => {
    expect(normalizeSettings({ opacity: 5, fontScale: 0 })).toMatchObject({ opacity: 1, fontScale: 0.6 });
    expect(normalizeSettings({ opacity: 'high', fontScale: NaN })).toMatchObject({ opacity: 0.55, fontScale: 1 });
  });

  it('keeps the development microphone switch and drops other values of it', () => {
    expect(normalizeSettings({ debugAudio: 'microphone' }).debugAudio).toBe('microphone');
    expect(normalizeSettings({ debugAudio: 'tab' }).debugAudio).toBeUndefined();
  });
});
