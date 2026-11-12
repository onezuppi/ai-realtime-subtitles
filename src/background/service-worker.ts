import { ASR_ENGINES, MT_ENGINES } from '../backends/browser/engines';
import { isDownloaded } from '../backends/browser/models';
import { loadSettings, type Message, type NativeReply, type NativeRequest, type Settings, type Status } from '../messages';

const OFFSCREEN = 'src/offscreen/offscreen.html';
let status: Status = { tabId: null, state: 'off' };

const setStatus = (next: Status) => {
  status = next;
  void chrome.action.setBadgeText({ text: next.state === 'off' ? '' : next.state === 'error' ? '!' : 'ON' });
  void chrome.runtime.sendMessage({ type: 'popup-status-update', status }).catch(() => {});
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

/**
 * Models are never downloaded behind the user's back: the user starts every download on the settings page.
 * The check lives here because the offscreen document has no access to chrome.storage.
 */
async function requireDownloaded(settings: Settings): Promise<void> {
  const missing: string[] = [];
  if (!(await isDownloaded({ kind: 'asr', id: settings.asrEngine }))) missing.push(ASR_ENGINES[settings.asrEngine].label);
  if (settings.mtEngine !== 'none' && !(await isDownloaded({ kind: 'mt', id: settings.mtEngine }))) missing.push(MT_ENGINES[settings.mtEngine].label);
  if (missing.length) throw new Error(`Download first in Settings: ${missing.join(', ')}`);
  const engine = ASR_ENGINES[settings.asrEngine];
  if (engine.needsLanguage && settings.sourceLang === 'auto') throw new Error(`${engine.label} cannot detect the language. Choose the language of the audio in Settings.`);
  if (engine.sourceCodes && settings.sourceLang !== 'auto' && !engine.sourceCodes.includes(settings.sourceLang)) {
    throw new Error(`${engine.label} does not support this language. Choose another speech model in Settings.`);
  }
}

async function start(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) throw new Error('No active tab');
  await stop();
  setStatus({ tabId: tab.id, state: 'loading' });
  const targetTabId = tab.id;
  const settings = await loadSettings();
  if (settings.mode === 'browser') await requireDownloaded(settings);
  const streamId =
    settings.debugAudio === 'microphone'
      ? ''
      : await new Promise<string>((resolve, reject) =>
          chrome.tabCapture.getMediaStreamId({ targetTabId }, id =>
            chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(id),
          ),
        );
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  await ensureOffscreen();
  await chrome.runtime.sendMessage({ type: 'offscreen-start', streamId, tabId: tab.id, settings } satisfies Message);
}

async function stop(): Promise<void> {
  const tabId = status.tabId;
  setStatus({ tabId: null, state: 'off' });
  await chrome.runtime.sendMessage({ type: 'offscreen-stop' } satisfies Message).catch(() => {});
  if (tabId !== null) await chrome.tabs.sendMessage(tabId, { type: 'caption', tabId, text: '' }).catch(() => {});
}

// Native messaging: one port to the companion program, requests matched to replies by id.
const NATIVE_HOST = 'com.ai_realtime_subtitles.companion';
let nativePort: chrome.runtime.Port | null = null;
let nextRequestId = 1;
const waiting = new Map<number, (reply: NativeReply) => void>();

function openNativePort(): chrome.runtime.Port {
  if (nativePort) return nativePort;
  const port = chrome.runtime.connectNative(NATIVE_HOST);
  port.onMessage.addListener((reply: NativeReply & { id: number }) => {
    waiting.get(reply.id)?.(reply);
    waiting.delete(reply.id);
  });
  port.onDisconnect.addListener(() => {
    const error = chrome.runtime.lastError?.message ?? 'The companion program closed the connection';
    for (const resolve of waiting.values()) resolve({ ok: false, error });
    waiting.clear();
    nativePort = null;
  });
  return (nativePort = port);
}

const callNative = (request: NativeRequest) =>
  new Promise<NativeReply>(resolve => {
    const id = nextRequestId++;
    waiting.set(id, resolve);
    try {
      openNativePort().postMessage({ id, ...request });
    } catch (error) {
      waiting.delete(id);
      resolve({ ok: false, error: String(error) });
    }
  });

chrome.runtime.onMessage.addListener((message: Message, _sender, respond) => {
  switch (message.type) {
    case 'native-request':
      callNative(message.request).then(respond);
      return true; // answer asynchronously
    case 'popup-start':
      start().catch(error => setStatus({ tabId: status.tabId, state: 'error', detail: String(error) }));
      break;
    case 'popup-stop':
      void stop();
      break;
    case 'popup-status':
      respond(status);
      break;
    case 'caption':
      chrome.tabs.sendMessage(message.tabId, message).catch(() => {});
      break;
    case 'status':
      if (message.tabId === status.tabId) setStatus({ tabId: message.tabId, state: message.state, detail: message.detail });
      break;
  }
});

chrome.tabs.onRemoved.addListener(tabId => {
  if (tabId === status.tabId) void stop();
});
