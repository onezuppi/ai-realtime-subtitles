import type { Message } from '../shared/messages';
import { callNative } from './native-port';
import { applyOffscreenStatus, failSession, getStatus, reinjectOverlay, restored, startSession, stopSession } from './session';

chrome.runtime.onMessage.addListener((message: Message, _sender, respond) => {
  switch (message.type) {
    case 'native-request':
      callNative(message.request).then(respond);
      return true; // answer asynchronously
    case 'popup-start':
      startSession().catch(failSession);
      break;
    case 'popup-stop':
      void stopSession();
      break;
    case 'popup-status':
      restored.then(() => respond(getStatus()));
      return true; // answer after the saved status is read
    case 'caption':
      chrome.tabs.sendMessage(message.tabId, message).catch(() => {});
      break;
    case 'status':
      applyOffscreenStatus(message);
      break;
  }
});

chrome.tabs.onRemoved.addListener(tabId => {
  if (tabId === getStatus().tabId) void stopSession();
});

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'complete') void reinjectOverlay(tabId);
});
