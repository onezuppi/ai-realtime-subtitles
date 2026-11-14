import { describe, expect, it } from 'vitest';
import { parseQwen3Output } from '../../src/core/qwen3-asr-output';

describe('parseQwen3Output', () => {
  it('splits the language and the text', () => {
    expect(parseQwen3Output('language Chinese<asr_text> 你好 ')).toEqual({ language: 'chinese', text: '你好' });
  });

  it('strips special tokens', () => {
    expect(parseQwen3Output('language English<asr_text>Hello there.<|im_end|>')).toEqual({ language: 'english', text: 'Hello there.' });
  });

  it('keeps plain text without the tag', () => {
    expect(parseQwen3Output(' hello ')).toEqual({ language: '', text: 'hello' });
  });

  it('returns only the text when the language was forced', () => {
    expect(parseQwen3Output('Hello there.', 'English')).toEqual({ language: '', text: 'Hello there.' });
  });

  it('treats "language None" as no language', () => {
    expect(parseQwen3Output('language None<asr_text>')).toEqual({ language: '', text: '' });
  });
});
