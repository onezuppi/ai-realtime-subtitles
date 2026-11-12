import { describe, expect, it } from 'vitest';
import { LlamaBackend, parseAsr } from '../src/backends/llama-http';
import { encodeWav } from '../src/backends/wav';

const reply = (text: string) => ({ choices: [{ message: { content: text } }] });

describe('parseAsr', () => {
  it('splits language and text', () => {
    expect(parseAsr('language Chinese<asr_text> 你好 ')).toEqual({ language: 'chinese', text: '你好' });
  });
  it('keeps plain text without the tag', () => {
    expect(parseAsr(' hello ')).toEqual({ language: '', text: 'hello' });
  });
});

describe('encodeWav', () => {
  it('writes a valid 16-bit mono header', () => {
    const wav = encodeWav(new Float32Array([0, 1, -1]), 16000);
    const view = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe('RIFF');
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint32(40, true)).toBe(6);
    expect(view.getInt16(46, true)).toBe(32767);
    expect(view.getInt16(48, true)).toBe(-32768);
  });
});

describe('LlamaBackend', () => {
  it('sends audio as input_audio and parses the answer', async () => {
    const calls: { url: string; body: any }[] = [];
    const backend = new LlamaBackend('http', undefined, async (url, body) => (calls.push({ url, body }), reply('language Spanish<asr_text>hola')));
    const result = await backend.transcribe(new Float32Array(160), 16000);
    expect(result).toEqual({ language: 'spanish', text: 'hola' });
    expect(calls[0]!.url).toBe('http://127.0.0.1:8083/v1/chat/completions');
    expect(calls[0]!.body.messages[0].content[0].input_audio.format).toBe('wav');
  });

  it('translates with history and the target language, then caches by language and text', async () => {
    const calls: any[] = [];
    const backend = new LlamaBackend('http', undefined, async (_url, body) => (calls.push(body), reply(' hello ')));
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
    const backend = new LlamaBackend('native', undefined, async () => reply(++n === 1 ? '' : 'ok'));
    expect(await backend.translate('x', 'es', 'en', [])).toBe('');
    expect(await backend.translate('x', 'es', 'en', [])).toBe('ok');
  });
});
