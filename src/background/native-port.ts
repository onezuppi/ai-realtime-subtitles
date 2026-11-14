import { NATIVE_HOST, type NativeReply, type NativeRequest } from '../shared/native-protocol';

// Native messaging: one port to the companion program, requests matched to replies by id.
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

export const callNative = (request: NativeRequest) =>
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
