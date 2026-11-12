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

export interface Backend {
  readonly kind: BackendKind;
  /** Load models or open the connection. Reports progress from 0 to 1. */
  start(onProgress?: (ratio: number) => void): Promise<void>;
  transcribe(samples: Float32Array, sampleRate: number): Promise<TranscribeResult>;
  /** Translate to the target language. History holds the last source/target pairs as context. */
  translate(text: string, sourceLanguage: string, targetLanguage: string, history: HistoryItem[]): Promise<string>;
  stop(): Promise<void>;
}
