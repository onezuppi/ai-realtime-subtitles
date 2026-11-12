/**
 * Log-mel features the way Qwen3-ASR expects them: the Whisper recipe with 128 mel bins, no padding to 30 s.
 * Checked against the WhisperFeatureExtractor of Transformers.js (see .e2e/qwen3-parity.mjs).
 */

export const SAMPLE_RATE = 16000;
export const N_FFT = 400;
export const HOP = 160;
export const N_MELS = 128;
const N_BINS = N_FFT / 2 + 1;

const hzToMel = (hz: number) => (hz < 1000 ? (3 * hz) / 200 : 15 + (Math.log(hz / 1000) * 27) / Math.log(6.4));
const melToHz = (mel: number) => (mel < 15 ? (200 * mel) / 3 : 1000 * Math.exp((Math.log(6.4) / 27) * (mel - 15)));

/** Slaney-scale triangular filters with Slaney normalisation. Returns [N_MELS][N_BINS]. */
export function melFilterBank(): Float32Array[] {
  const melMin = hzToMel(0);
  const melMax = hzToMel(SAMPLE_RATE / 2);
  const edges = Array.from({ length: N_MELS + 2 }, (_, i) => melToHz(melMin + ((melMax - melMin) * i) / (N_MELS + 1)));
  const fft = Array.from({ length: N_BINS }, (_, i) => ((SAMPLE_RATE / 2) * i) / (N_BINS - 1));
  return Array.from({ length: N_MELS }, (_, m) => {
    const row = new Float32Array(N_BINS);
    const lower = edges[m]!;
    const centre = edges[m + 1]!;
    const upper = edges[m + 2]!;
    const norm = 2 / (upper - lower);
    for (let k = 0; k < N_BINS; k++) {
      const f = fft[k]!;
      const down = (f - lower) / (centre - lower);
      const up = (upper - f) / (upper - centre);
      row[k] = Math.max(0, Math.min(down, up)) * norm;
    }
    return row;
  });
}

let tables: { cos: Float32Array; sin: Float32Array; window: Float32Array; filters: Float32Array[] } | null = null;
function getTables() {
  if (tables) return tables;
  const cos = new Float32Array(N_BINS * N_FFT);
  const sin = new Float32Array(N_BINS * N_FFT);
  for (let k = 0; k < N_BINS; k++) {
    for (let n = 0; n < N_FFT; n++) {
      const angle = (2 * Math.PI * k * n) / N_FFT;
      cos[k * N_FFT + n] = Math.cos(angle);
      sin[k * N_FFT + n] = Math.sin(angle);
    }
  }
  // Periodic Hann window.
  const window = Float32Array.from({ length: N_FFT }, (_, n) => 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N_FFT));
  return (tables = { cos, sin, window, filters: melFilterBank() });
}

const reflect = (index: number, length: number) => {
  let i = index;
  if (i < 0) i = -i;
  if (i >= length) i = 2 * (length - 1) - i;
  return i;
};

/**
 * Returns the features as [N_MELS, frames] in row-major order, ready for a [1, 128, frames] tensor.
 * `samples` are mono, 16 kHz.
 */
export function logMel(samples: Float32Array): { data: Float32Array; frames: number } {
  const { cos, sin, window, filters } = getTables();
  const frames = Math.floor(samples.length / HOP); // the STFT has one more frame, which Whisper drops
  const padded = new Float32Array(samples.length + N_FFT);
  const half = N_FFT / 2;
  for (let i = 0; i < padded.length; i++) padded[i] = samples[reflect(i - half, samples.length)] ?? 0;

  const data = new Float32Array(N_MELS * frames);
  const frame = new Float32Array(N_FFT);
  const power = new Float32Array(N_BINS);
  let max = -Infinity;
  for (let t = 0; t < frames; t++) {
    const start = t * HOP;
    for (let n = 0; n < N_FFT; n++) frame[n] = padded[start + n]! * window[n]!;
    for (let k = 0; k < N_BINS; k++) {
      let re = 0;
      let im = 0;
      const base = k * N_FFT;
      for (let n = 0; n < N_FFT; n++) {
        re += frame[n]! * cos[base + n]!;
        im -= frame[n]! * sin[base + n]!;
      }
      power[k] = re * re + im * im;
    }
    for (let m = 0; m < N_MELS; m++) {
      const row = filters[m]!;
      let sum = 0;
      for (let k = 0; k < N_BINS; k++) sum += row[k]! * power[k]!;
      const value = Math.log10(Math.max(sum, 1e-10));
      data[m * frames + t] = value;
      if (value > max) max = value;
    }
  }
  const floor = max - 8;
  for (let i = 0; i < data.length; i++) data[i] = (Math.max(data[i]!, floor) + 4) / 4;
  return { data, frames };
}

/** How many audio tokens the decoder prompt holds for `frames` mel frames (the Qwen3-ASR conv stack). */
export function audioTokenCount(frames: number): number {
  const half = (n: number) => Math.floor((n + 1) / 2);
  return half(half(half(frames % 100))) + Math.floor(frames / 100) * 13;
}
