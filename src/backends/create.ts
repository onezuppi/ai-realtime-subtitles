import type { Backend, BackendKind } from '../core/backend';
import { LlamaBackend } from './llama-http';

export function createBackend(kind: BackendKind): Backend {
  switch (kind) {
    case 'http':
      return new LlamaBackend('http');
    case 'browser':
    case 'native':
      throw new Error(`Mode "${kind}" is not implemented yet`);
  }
}
