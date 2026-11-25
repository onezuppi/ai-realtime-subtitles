import type { Backend, BackendKind, HistoryItem, TranscribeResult } from '../../core/backend';
import { parseQwen3Output } from '../../core/qwen3-asr-output';
import { httpTransport, type Transport } from './transport';
import { encodeWav, toBase64 } from './wav';

export interface LlamaEndpoints {
  /** llama-server with Qwen3-ASR, for example http://127.0.0.1:8083 */
  asr: string;
  /** llama-server with PLaMo 3 Translate, for example http://127.0.0.1:8082 */
  translate: string;
}

const ASR_TIMEOUT_MS = 15000;
const TRANSLATE_TIMEOUT_MS = 8000;
const ASR_MAX_TOKENS = 96;
const TRANSLATE_MAX_TOKENS = 256;
const CACHE_LIMIT = 200;

export const DEFAULT_ENDPOINTS: LlamaEndpoints = { asr: 'http://127.0.0.1:8083', translate: 'http://127.0.0.1:8082' };

interface ChatReply {
  choices?: { message?: { content?: string } }[];
}

const content = (reply: unknown) => (reply as ChatReply).choices?.[0]?.message?.content ?? '';

/** Backend for llama.cpp servers. The HTTP and native-bridge modes share it: only the transport differs. */
export class LlamaBackend implements Backend {
  private readonly cache = new Map<string, string>();

  constructor(
    readonly kind: BackendKind = 'http',
    private readonly endpoints: LlamaEndpoints = DEFAULT_ENDPOINTS,
    private readonly transport: Transport = httpTransport,
    /** False for plain subtitles: the translation server is neither checked nor started. */
    private readonly withTranslation = true,
  ) {}

  async start(): Promise<void> {
    await this.transport.ready(this.endpoints.asr);
    if (this.withTranslation) await this.transport.ready(this.endpoints.translate);
  }

  async transcribe(samples: Float32Array, sampleRate: number): Promise<TranscribeResult> {
    const data = toBase64(encodeWav(samples, sampleRate));
    const reply = await this.transport.post(
      this.endpoints.asr,
      '/v1/chat/completions',
      {
        temperature: 0,
        max_tokens: ASR_MAX_TOKENS,
        messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data, format: 'wav' } }] }],
      },
      ASR_TIMEOUT_MS,
    );
    return parseQwen3Output(content(reply));
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
    const reply = await this.transport.post(
      this.endpoints.translate,
      '/v1/chat/completions',
      {
        model: 'plamo-3-translate',
        temperature: 0,
        max_tokens: TRANSLATE_MAX_TOKENS,
        stop: ['<|plamo:tag|>', '<|plamo:bos|>'],
        chat_template_kwargs: { target_lang: targetLanguage },
        messages,
      },
      TRANSLATE_TIMEOUT_MS,
    );
    const translated = content(reply).trim();
    if (translated) {
      if (this.cache.size > CACHE_LIMIT) this.cache.clear();
      this.cache.set(key, translated);
    }
    return translated;
  }

  async stop(): Promise<void> {
    this.cache.clear();
  }
}
