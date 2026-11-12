import { loadSettings, type Message, type Status } from '../messages';

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

async function start(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) throw new Error('No active tab');
  await stop();
  setStatus({ tabId: tab.id, state: 'loading' });
  const targetTabId = tab.id;
  const streamId = await new Promise<string>((resolve, reject) =>
    chrome.tabCapture.getMediaStreamId({ targetTabId }, id =>
      chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(id),
    ),
  );
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  await ensureOffscreen();
  const settings = await loadSettings();
  await chrome.runtime.sendMessage({ type: 'offscreen-start', streamId, tabId: tab.id, settings } satisfies Message);
}

async function stop(): Promise<void> {
  const tabId = status.tabId;
  setStatus({ tabId: null, state: 'off' });
  await chrome.runtime.sendMessage({ type: 'offscreen-stop' } satisfies Message).catch(() => {});
  if (tabId !== null) await chrome.tabs.sendMessage(tabId, { type: 'caption', tabId, text: '' }).catch(() => {});
}

chrome.runtime.onMessage.addListener((message: Message, _sender, respond) => {
  switch (message.type) {
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
