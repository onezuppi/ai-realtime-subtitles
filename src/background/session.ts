import type { Message, Status } from '../shared/messages';
import { loadSettings } from '../shared/settings-store';
import { requireDownloaded } from './preflight';

const OFFSCREEN = 'src/offscreen/offscreen.html';

let status: Status = { tabId: null, state: 'off' };

export const getStatus = (): Status => status;

const setStatus = (next: Status) => {
  status = next;
  void chrome.action.setBadgeText({ text: next.state === 'off' ? '' : next.state === 'error' ? '!' : 'ON' });
  void chrome.runtime.sendMessage({ type: 'popup-status-update', status } satisfies Message).catch(() => {});
};

async function ensureOffscreen(): Promise<void> {
  const existing = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
  if (existing.length) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN,
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: 'Capture tab audio and run speech recognition',
  });
}

const getStreamId = (targetTabId: number) =>
  new Promise<string>((resolve, reject) =>
    chrome.tabCapture.getMediaStreamId({ targetTabId }, id =>
      chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(id),
    ),
  );

/** Captures the active tab: asks Chrome for the stream, injects the overlay and starts the offscreen document. */
export async function startSession(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) throw new Error('No active tab');
  await stopSession();
  setStatus({ tabId: tab.id, state: 'loading' });
  const settings = await loadSettings();
  if (settings.mode === 'browser') await requireDownloaded(settings);
  const streamId = settings.debugAudio === 'microphone' ? '' : await getStreamId(tab.id);
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  await ensureOffscreen();
  await chrome.runtime.sendMessage({ type: 'offscreen-start', streamId, tabId: tab.id, settings } satisfies Message);
}

export async function stopSession(): Promise<void> {
  const tabId = status.tabId;
  setStatus({ tabId: null, state: 'off' });
  await chrome.runtime.sendMessage({ type: 'offscreen-stop' } satisfies Message).catch(() => {});
  if (tabId !== null) await chrome.tabs.sendMessage(tabId, { type: 'caption', tabId, text: '' } satisfies Message).catch(() => {});
}

export const failSession = (error: unknown) => setStatus({ tabId: status.tabId, state: 'error', detail: String(error) });

/** Status reported by the offscreen document. Messages about a tab that is no longer captured are ignored. */
export function applyOffscreenStatus(message: Extract<Message, { type: 'status' }>): void {
  if (message.tabId === status.tabId) setStatus({ tabId: message.tabId, state: message.state, detail: message.detail });
}
