import type { Backend } from '../core/backend';
import type { Settings } from '../messages';
import { BrowserBackend } from './browser/browser-backend';
import { createModelWorker, wasmBaseUrl } from './browser/models';
import { LlamaBackend } from './llama-http';
import { NATIVE_ENDPOINTS, nativeTransport, sendViaServiceWorker } from './native';

export function createBackend(settings: Settings): Backend {
  switch (settings.mode) {
    case 'http':
      return new LlamaBackend('http');
    case 'native':
      return new LlamaBackend('native', NATIVE_ENDPOINTS, nativeTransport(sendViaServiceWorker));
    case 'browser':
      return new BrowserBackend({
        asr: settings.asrEngine,
        mt: settings.mtEngine,
        sourceLang: settings.sourceLang,
        modelHost: settings.modelHost,
        wasmBase: wasmBaseUrl(),
        createWorker: createModelWorker,
      });
  }
}
