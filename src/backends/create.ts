import type { Backend, BackendKind } from '../core/backend';
import { LlamaBackend } from './llama-http';
import { NATIVE_ENDPOINTS, nativeTransport, sendViaServiceWorker } from './native';

export function createBackend(kind: BackendKind): Backend {
  switch (kind) {
    case 'http':
      return new LlamaBackend('http');
    case 'native':
      return new LlamaBackend('native', NATIVE_ENDPOINTS, nativeTransport(sendViaServiceWorker));
    case 'browser':
      throw new Error('Mode "browser" is not implemented yet');
  }
}
