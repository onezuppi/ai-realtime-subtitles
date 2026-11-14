import { describe, expect, it } from 'vitest';
import { encodeWav } from '../../../src/backends/llama/wav';

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
