/** One recognition + translation engine. The browser, HTTP and native-bridge modes each implement it. */
export type BackendKind = 'browser' | 'http' | 'native';

export interface TranscribeResult {
  /** Detected language code, for example "zh" or "es". */
  language: string;
  text: string;
}

export interface HistoryItem {
  source: string;
  target: string;
}

/** Download state reported while models are loaded. */
export interface Progress {
  /** 0 to 1 over all files of the request. */
  ratio: number;
  loadedBytes: number;
  totalBytes: number;
  /** The file that moved last. */
  file: string;
}

export interface Backend {
  readonly kind: BackendKind;
  /** Load models or open the connection. Reports download progress when files are fetched. */
  start(onProgress?: (progress: Progress) => void): Promise<void>;
  transcribe(samples: Float32Array, sampleRate: number): Promise<TranscribeResult>;
  /** Translate to the target language. History holds the last source/target pairs as context. */
  translate(text: string, sourceLanguage: string, targetLanguage: string, history: HistoryItem[]): Promise<string>;
  stop(): Promise<void>;
}
