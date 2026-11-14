import { SETTINGS_KEY } from './storage-keys';
import { normalizeSettings, type Settings } from './settings';

export async function loadSettings(): Promise<Settings> {
  return normalizeSettings((await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY]);
}

/**
 * Reads the stored settings, applies the change and writes the result back.
 * Callers pass only what they changed, so two open pages cannot overwrite each other's choices.
 */
export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const settings = normalizeSettings({ ...(await loadSettings()), ...patch });
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  return settings;
}

/** Calls `listener` with the new settings whenever any page changes them. */
export function watchSettings(listener: (settings: Settings) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[SETTINGS_KEY]) listener(normalizeSettings(changes[SETTINGS_KEY].newValue));
  });
}
