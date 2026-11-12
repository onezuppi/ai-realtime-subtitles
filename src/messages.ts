import type { BackendKind } from './core/backend';

export interface Settings {
  mode: BackendKind;
  /** Target language of the captions, for example "en" or "ru". */
  targetLang: string;
  /** Development only: listen to the default microphone instead of the tab (used with a fake audio device in tests). */
  debugAudio?: 'microphone';
}

export const DEFAULT_SETTINGS: Settings = { mode: 'http', targetLang: 'en' };

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(stored.settings as Partial<Settings> | undefined) };
}

export const saveSettings = (settings: Settings) => chrome.storage.local.set({ settings });

/** A request for the companion program (see companion/ai_subtitles_companion/bridge.py). */
export interface NativeRequest {
  target: 'asr' | 'translate' | 'companion';
  path: string;
  method: 'GET' | 'POST';
  body?: unknown;
}

export interface NativeReply {
  ok: boolean;
  status?: number;
  data?: unknown;
  error?: string;
}

export type Message =
  | { type: 'native-request'; request: NativeRequest }
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
