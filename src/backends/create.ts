import type { Backend } from '../core/backend';
import { effectiveMtEngine, type Settings } from '../shared/settings';
import { BrowserBackend } from './browser/browser-backend';
import { createModelWorker, wasmBaseUrl } from './browser/models/worker-factory';
import { LlamaBackend } from './llama/llama-backend';
import { NATIVE_ENDPOINTS, nativeTransport, sendViaServiceWorker } from './llama/native-transport';

export function createBackend(settings: Settings): Backend {
  switch (settings.mode) {
    case 'http':
      return new LlamaBackend('http', undefined, undefined, settings.translate);
    case 'native':
      return new LlamaBackend('native', NATIVE_ENDPOINTS, nativeTransport(sendViaServiceWorker), settings.translate);
    case 'browser':
      return new BrowserBackend({
        asr: settings.asrEngine,
        mt: effectiveMtEngine(settings),
        sourceLang: settings.sourceLang,
        modelHost: settings.modelHost,
        wasmBase: wasmBaseUrl(),
        createWorker: createModelWorker,
      });
  }
}
