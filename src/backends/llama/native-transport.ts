import type { NativeReply, NativeRequest } from '../../shared/native-protocol';
import type { LlamaEndpoints } from './llama-backend';
import type { Transport } from './transport';

/** Endpoints for the bridge: the host maps these fixed names to its own local servers. */
export const NATIVE_ENDPOINTS: LlamaEndpoints = { asr: 'native://asr', translate: 'native://translate' };

const target = (base: string): NativeRequest['target'] => (base === NATIVE_ENDPOINTS.asr ? 'asr' : 'translate');

type Send = (request: NativeRequest) => Promise<NativeReply>;

/** Sends requests to the companion program. `send` goes through the service worker, which owns the native port. */
export function nativeTransport(send: Send): Transport {
  const call = async (request: NativeRequest) => {
    const reply = await send(request);
    if (!reply.ok) throw new Error(reply.error ?? `bridge answered HTTP ${reply.status ?? '?'}`);
    return reply.data;
  };
  return {
    post: (base, path, body) => call({ target: target(base), path, method: 'POST', body }),
    async ready(base) {
      // Starts only the server this call is about: plain subtitles never load the translation model.
      await call({ target: 'companion', path: '/start', method: 'POST', body: { targets: [target(base)] } });
      await call({ target: target(base), path: '/health', method: 'GET' });
    },
  };
}

export const sendViaServiceWorker: Send = request =>
  chrome.runtime.sendMessage({ type: 'native-request', request }).then((reply: NativeReply | undefined) => {
    if (!reply) throw new Error('No answer from the service worker');
    return reply;
  });
