import { describe, expect, it } from 'vitest';
import { LlamaBackend } from '../../../src/backends/llama/llama-backend';
import type { Transport } from '../../../src/backends/llama/transport';

const reply = (text: string) => ({ choices: [{ message: { content: text } }] });
const transport = (post: (url: string, body: any) => Promise<unknown>): Transport => ({ post: (base, path, body) => post(base + path, body), ready: async () => {} });

describe('LlamaBackend', () => {
  it('checks the translation server only when translation is on', async () => {
    const checked: string[] = [];
    const watching: Transport = { post: async () => ({}), ready: async base => void checked.push(base) };
    await new LlamaBackend('http', undefined, watching, false).start();
    expect(checked).toEqual(['http://127.0.0.1:8083']);
    checked.length = 0;
    await new LlamaBackend('http', undefined, watching, true).start();
    expect(checked).toEqual(['http://127.0.0.1:8083', 'http://127.0.0.1:8082']);
  });

  it('sends audio as input_audio and parses the answer', async () => {
    const calls: { url: string; body: any }[] = [];
    const backend = new LlamaBackend('http', undefined, transport(async (url, body) => (calls.push({ url, body }), reply('language Spanish<asr_text>hola'))));
    const result = await backend.transcribe(new Float32Array(160), 16000);
    expect(result).toEqual({ language: 'spanish', text: 'hola' });
    expect(calls[0]!.url).toBe('http://127.0.0.1:8083/v1/chat/completions');
    expect(calls[0]!.body.messages[0].content[0].input_audio.format).toBe('wav');
  });

  it('translates with history and the target language, then caches by language and text', async () => {
    const calls: any[] = [];
    const backend = new LlamaBackend('http', undefined, transport(async (_url, body) => (calls.push(body), reply(' hello '))));
    const history = [{ source: 'a', target: 'b' }];
    expect(await backend.translate('hola', 'es', 'en', history)).toBe('hello');
    expect(calls[0].chat_template_kwargs).toEqual({ target_lang: 'en' });
    expect(calls[0].messages).toEqual([
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'hola' },
    ]);
    expect(await backend.translate('hola', 'es', 'en', [])).toBe('hello');
    expect(calls).toHaveLength(1);
    await backend.translate('hola', 'es', 'ru', []);
    expect(calls).toHaveLength(2);
  });

  it('does not cache an empty translation', async () => {
    let n = 0;
    const backend = new LlamaBackend('native', undefined, transport(async () => reply(++n === 1 ? '' : 'ok')));
    expect(await backend.translate('x', 'es', 'en', [])).toBe('');
    expect(await backend.translate('x', 'es', 'en', [])).toBe('ok');
  });
});

