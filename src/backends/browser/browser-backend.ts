import type { Backend, HistoryItem, Progress, TranscribeResult } from '../../core/backend';
import type { AsrEngineId, MtEngineId } from './engines';
import type { FromWorker, ToWorker } from './protocol';

export interface BrowserBackendOptions {
  asr: AsrEngineId;
  mt: MtEngineId;
  /** Language of the audio, or "auto". */
  sourceLang: string;
  modelHost: string;
  /** Where the ONNX runtime files are served from. */
  wasmBase: string;
  /** Creates the worker. Replaced in tests. */
  createWorker: () => WorkerLike;
}

export interface WorkerLike {
  postMessage(message: ToWorker, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<FromWorker>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

/** Runs recognition and translation in a worker inside the browser. Nothing leaves the machine except the model download. */
export class BrowserBackend implements Backend {
  readonly kind = 'browser' as const;
  private worker: WorkerLike | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (text: string) => void; reject: (error: Error) => void }>();
  private onProgress: (progress: Progress) => void = () => {};
  private ready: { resolve: () => void; reject: (error: Error) => void } | null = null;

  constructor(private readonly options: BrowserBackendOptions) {}

  start(onProgress?: (progress: Progress) => void): Promise<void> {
    this.onProgress = onProgress ?? (() => {});
    const worker = this.options.createWorker();
    this.worker = worker;
    worker.onmessage = event => this.handle(event.data);
    worker.onerror = event => this.fail(new Error(event.message || 'The model worker crashed'));
    return new Promise<void>((resolve, reject) => {
      this.ready = { resolve, reject };
      worker.postMessage({ type: 'init', asr: this.options.asr, mt: this.options.mt, modelHost: this.options.modelHost, wasmBase: this.options.wasmBase });
    });
  }

  private handle(message: FromWorker) {
    switch (message.type) {
      case 'progress':
        this.onProgress(message);
        break;
      case 'ready':
        this.ready?.resolve();
        this.ready = null;
        break;
      case 'result':
        this.pending.get(message.id)?.resolve(message.text);
        this.pending.delete(message.id);
        break;
      case 'error': {
        const error = new Error(message.message);
        if (message.id !== undefined) {
          this.pending.get(message.id)?.reject(error);
          this.pending.delete(message.id);
        } else {
          this.fail(error);
        }
        break;
      }
    }
  }

  private fail(error: Error) {
    this.ready?.reject(error);
    this.ready = null;
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
  }

  private request(build: (id: number) => ToWorker, transfer: Transferable[] = []): Promise<string> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new Error('The backend is not started'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage(build(id), transfer);
    });
  }

  async transcribe(samples: Float32Array): Promise<TranscribeResult> {
    // Copy: the worker takes the buffer, and the caller may still hold the samples.
    const copy = samples.slice();
    const text = await this.request(id => ({ type: 'transcribe', id, samples: copy, language: this.options.sourceLang }), [copy.buffer]);
    return { language: this.options.sourceLang === 'auto' ? '' : this.options.sourceLang, text };
  }

  translate(text: string, _sourceLanguage: string, targetLanguage: string, _history: HistoryItem[]): Promise<string> {
    if (this.options.mt === 'none') return Promise.resolve(text);
    return this.request(id => ({ type: 'translate', id, text, target: targetLanguage }));
  }

  async stop(): Promise<void> {
    this.worker?.terminate();
    this.worker = null;
    this.fail(new Error('Stopped'));
  }
}
