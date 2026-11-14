import type { Message } from '../shared/messages';
import { startCapture, type CaptureSession } from './capture-session';

const send = (message: Message) => void chrome.runtime.sendMessage(message).catch(() => {});

let session: CaptureSession | null = null;

async function stop(): Promise<void> {
  const current = session;
  session = null;
  await current?.stop();
}

chrome.runtime.onMessage.addListener((message: Message) => {
  if (message.type === 'offscreen-start') {
    const { streamId, tabId, settings } = message;
    stop()
      .then(() => send({ type: 'status', tabId, state: 'loading' }))
      .then(() => startCapture(streamId, tabId, settings))
      .then(started => {
        session = started;
      })
      .catch(error => send({ type: 'status', tabId, state: 'error', detail: String(error) }));
  } else if (message.type === 'offscreen-stop') {
    void stop();
  }
});
