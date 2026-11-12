import type { Backend, BackendKind, HistoryItem, TranscribeResult } from '../core/backend';
import { encodeWav, toBase64 } from './wav';

export interface LlamaEndpoints {
  /** llama-server with Qwen3-ASR, for example http://127.0.0.1:8083 */
  asr: string;
  /** llama-server with PLaMo 3 Translate, for example http://127.0.0.1:8082 */
  translate: string;
}

export const DEFAULT_ENDPOINTS: LlamaEndpoints = { asr: 'http://127.0.0.1:8083', translate: 'http://127.0.0.1:8082' };

type Post = (url: string, body: unknown, timeoutMs: number) => Promise<unknown>;

/** Posts JSON to a llama-server. Replaceable, so the native bridge can carry the same requests. */
export const fetchPost: Post = async (url, body, timeoutMs) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`);
  return response.json();
};

interface ChatReply {
  choices?: { message?: { content?: string } }[];
}

const content = (reply: unknown) => (reply as ChatReply).choices?.[0]?.message?.content ?? '';

/** Qwen3-ASR answers "language X<asr_text>text". Returns both parts. */
export function parseAsr(raw: string): TranscribeResult {
  const match = raw.match(/^language\s+(\S+)<asr_text>([\s\S]*)$/);
  return match ? { language: (match[1] ?? '').toLowerCase(), text: (match[2] ?? '').trim() } : { language: '', text: raw.trim() };
}

/** Backend for llama.cpp servers. The same class serves the HTTP and the native-bridge modes: only `post` differs. */
export class LlamaBackend implements Backend {
  private readonly cache = new Map<string, string>();

  constructor(
    readonly kind: BackendKind = 'http',
    private readonly endpoints: LlamaEndpoints = DEFAULT_ENDPOINTS,
    private readonly post: Post = fetchPost,
  ) {}

  async start(): Promise<void> {
    // Fail early with a clear message when a server is not running.
    for (const base of [this.endpoints.asr, this.endpoints.translate]) {
      const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(3000) });
      if (!response.ok) throw new Error(`${base} is not ready (HTTP ${response.status})`);
    }
  }

  async transcribe(samples: Float32Array, sampleRate: number): Promise<TranscribeResult> {
    const data = toBase64(encodeWav(samples, sampleRate));
    const reply = await this.post(
      `${this.endpoints.asr}/v1/chat/completions`,
      {
        temperature: 0,
        max_tokens: 96,
        messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data, format: 'wav' } }] }],
      },
      15000,
    );
    return parseAsr(content(reply));
  }

  async translate(text: string, _sourceLanguage: string, targetLanguage: string, history: HistoryItem[]): Promise<string> {
    // The cache key holds language and text only: the same phrase translates the same way whatever came before.
    const key = `${targetLanguage}|${text}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const messages = [
      ...history.flatMap(pair => [
        { role: 'user', content: pair.source },
        { role: 'assistant', content: pair.target },
      ]),
      { role: 'user', content: text },
    ];
    const reply = await this.post(
      `${this.endpoints.translate}/v1/chat/completions`,
      {
        model: 'plamo-3-translate',
        temperature: 0,
        max_tokens: 256,
        stop: ['<|plamo:tag|>', '<|plamo:bos|>'],
        chat_template_kwargs: { target_lang: targetLanguage },
        messages,
      },
      8000,
    );
    const translated = content(reply).trim();
    if (translated) {
      if (this.cache.size > 200) this.cache.clear();
      this.cache.set(key, translated);
    }
    return translated;
  }

  async stop(): Promise<void> {
    this.cache.clear();
  }
}
