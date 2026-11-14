import { describe, expect, it } from 'vitest';
import { SubtitleStream, type Caption, type SubtitleStreamHandlers } from '../../src/core/subtitle-stream';

const RATE = 1000; // 1 sample = 1 ms
const block = (value: number, ms = 250) => new Float32Array(ms).fill(value);

function setup(options = {}, overrides: Partial<SubtitleStreamHandlers> = {}) {
  const captions: Caption[] = [];
  const inputs: Float32Array[] = [];
  const errors: unknown[] = [];
  const history: unknown[] = [];
  const stream = new SubtitleStream(
    {
      transcribe: async samples => `phrase ${inputs.push(samples)}`,
      translate: async (source, past) => (history.push(structuredClone(past)), `translated ${source}`),
      emit: caption => void captions.push(caption),
      onError: error => void errors.push(error),
      ...overrides,
    },
    { sampleRate: RATE, silenceMs: 500, maxMs: 4000, softMs: 0, threshold: 0.0015, minSpeechMs: 0, maxPending: 0, ...options },
  );
  return { stream, captions, inputs, errors, history };
}

const pause = (stream: SubtitleStream) => {
  stream.push(block(0));
  stream.push(block(0));
};

describe('SubtitleStream', () => {
  it('waits for a pause and handles each phrase once', async () => {
    const { stream, captions } = setup();
    stream.push(block(0.1));
    stream.push(block(0.2));
    await stream.idle();
    expect(captions).toHaveLength(0);
    pause(stream);
    await stream.idle();
    expect(captions.map(c => c.text)).toEqual(['translated phrase 1']);
    pause(stream);
    await stream.idle();
    expect(captions).toHaveLength(1);
  });

  it('does not mix speech of consecutive phrases', async () => {
    const { stream, inputs } = setup();
    stream.push(block(0.1));
    pause(stream);
    stream.push(block(0.2));
    pause(stream);
    await stream.idle();
    expect(inputs).toHaveLength(2);
    expect(inputs[0]!.every(v => v === 0 || Math.abs(v - 0.1) < 1e-6)).toBe(true);
    expect(inputs[1]!.every(v => v === 0 || Math.abs(v - 0.2) < 1e-6)).toBe(true);
  });

  it('cuts continuous speech at maxMs', async () => {
    const { stream, inputs } = setup({ maxMs: 1000 });
    for (let i = 0; i < 4; i++) stream.push(block(0.1));
    await stream.idle();
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.length).toBe(1000);
  });

  it('soft-cuts at a short pause once the segment is long enough', async () => {
    const { stream, inputs } = setup({ softMs: 1000, softSilenceMs: 250, maxMs: 6000 });
    for (let i = 0; i < 4; i++) stream.push(block(0.1));
    stream.push(block(0));
    await stream.idle();
    expect(inputs).toHaveLength(1);
  });

  it('does not soft-cut before softMs', async () => {
    const { stream, inputs } = setup({ softMs: 3000, softSilenceMs: 250 });
    stream.push(block(0.1));
    stream.push(block(0));
    await stream.idle();
    expect(inputs).toHaveLength(0);
  });

  it('drops segments with too little voiced audio', async () => {
    const { stream, inputs } = setup({ minSpeechMs: 300 });
    stream.push(block(0.1, 250));
    pause(stream);
    await stream.idle();
    expect(inputs).toHaveLength(0);
  });

  it('keeps capturing while the previous segment is busy and drops the oldest over maxPending', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => (release = resolve));
    let drops = 0;
    const { stream, captions } = setup(
      { maxPending: 2 },
      {
        transcribe: async () => (await gate, 'text'),
        onDrop: () => void drops++,
      },
    );
    for (let i = 0; i < 5; i++) {
      stream.push(block(0.1));
      pause(stream);
    }
    expect(drops).toBeGreaterThan(0);
    release();
    await stream.idle();
    expect(captions.length).toBeLessThanOrEqual(3);
  });

  it('discards results of an old generation after reset', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => (release = resolve));
    const { stream, captions } = setup({}, { transcribe: async () => (await gate, 'old') });
    stream.push(block(0.1));
    pause(stream);
    stream.reset();
    release();
    await stream.idle();
    expect(captions).toHaveLength(0);
  });

  it('passes the last two pairs as context', async () => {
    const { stream, history } = setup();
    for (let i = 0; i < 4; i++) {
      stream.push(block(0.1));
      pause(stream);
      await stream.idle();
    }
    expect(history[3]).toEqual([
      { source: 'phrase 2', target: 'translated phrase 2' },
      { source: 'phrase 3', target: 'translated phrase 3' },
    ]);
  });

  it('reports an empty translation as an error', async () => {
    const { stream, errors, captions } = setup({}, { translate: async () => '  ' });
    stream.push(block(0.1));
    pause(stream);
    await stream.idle();
    expect(errors).toHaveLength(1);
    expect(captions).toHaveLength(0);
  });
});
