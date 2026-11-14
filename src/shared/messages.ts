import type { Settings } from './settings';
import type { NativeRequest } from './native-protocol';

/** State of one subtitle session, shown in the popup. */
export type SessionState = 'off' | 'loading' | 'listening' | 'busy' | 'error';

export interface Status {
  tabId: number | null;
  state: SessionState;
  detail?: string;
}

/** Messages sent with chrome.runtime.sendMessage between the extension's contexts. */
export type Message =
  | { type: 'native-request'; request: NativeRequest }
  | { type: 'popup-start' }
  | { type: 'popup-stop' }
  | { type: 'popup-status' }
  | { type: 'popup-status-update'; status: Status }
  | { type: 'offscreen-start'; streamId: string; tabId: number; settings: Settings }
  | { type: 'offscreen-stop' }
  | { type: 'caption'; tabId: number; text: string }
  | { type: 'status'; tabId: number; state: Exclude<SessionState, 'off'>; detail?: string };
