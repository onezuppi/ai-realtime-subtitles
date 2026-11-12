import type { BackendKind } from './core/backend';

export interface Settings {
  mode: BackendKind;
  /** Target language of the captions, for example "en" or "ru". */
  targetLang: string;
}

export const DEFAULT_SETTINGS: Settings = { mode: 'http', targetLang: 'en' };

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(stored.settings as Partial<Settings> | undefined) };
}

export const saveSettings = (settings: Settings) => chrome.storage.local.set({ settings });

export type Message =
  | { type: 'popup-start' }
  | { type: 'popup-stop' }
  | { type: 'popup-status' }
  | { type: 'offscreen-start'; streamId: string; tabId: number; settings: Settings }
  | { type: 'offscreen-stop' }
  | { type: 'caption'; tabId: number; text: string }
  | { type: 'status'; tabId: number; state: 'loading' | 'listening' | 'busy' | 'error'; detail?: string };

export interface Status {
  tabId: number | null;
  state: 'off' | 'loading' | 'listening' | 'busy' | 'error';
  detail?: string;
}
