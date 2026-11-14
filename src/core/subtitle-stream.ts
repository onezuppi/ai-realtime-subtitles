import { AUDIO_SAMPLE_RATE } from './audio';
import type { HistoryItem } from './backend';

/** Segmentation values tuned on real zh/ja/es/de clips. */
export interface SegmentationOptions {
  sampleRate: number;
  /** Close a segment after this much silence. */
  silenceMs: number;
  /** Hard cut for continuous speech. */
  maxMs: number;
  /** Once a segment is softMs long, close it at the first pause of softSilenceMs (a comma). 0 disables. */
  softMs: number;
  softSilenceMs: number;
  /** Fixed RMS level that counts as speech. */
  threshold: number;
  /** When above 0 the threshold also follows the measured room noise. */
  floorMultiplier: number;
  /** Drop segments with less voiced audio than this (clicks, coughs). */
  minSpeechMs: number;
  /** Segments waiting for the models are limited to this number, oldest dropped first. 0 disables. */
  maxPending: number;
}

export const TUNED: SegmentationOptions = {
  sampleRate: AUDIO_SAMPLE_RATE,
  silenceMs: 400,
  maxMs: 6000,
  softMs: 3000,
  softSilenceMs: 250,
  threshold: 0.003,
  floorMultiplier: 0,
  minSpeechMs: 300,
  maxPending: 3,
};

export interface Caption {
  text: string;
  source: string;
}

export interface SubtitleStreamHandlers {
  transcribe(samples: Float32Array): Promise<string>;
  translate(source: string, history: HistoryItem[]): Promise<string>;
  emit(caption: Caption): void | Promise<void>;
  cleanText?(text: string): string;
  onState?(state: 'busy' | 'idle'): void;
  onError?(error: unknown): void;
  onDrop?(): void;
}

interface Job {
  samples: Float32Array;
  generation: number;
}

/** Cuts a continuous audio stream into phrases, then recognises and translates each phrase once, in order. */
export class SubtitleStream {
  private readonly options: SegmentationOptions;
  private readonly handlers: Required<SubtitleStreamHandlers>;
  private generation = 0;
  private jobs: Job[] = [];
  private chain: Promise<void> = Promise.resolve();
  private running = false;
  private buffers: Float32Array[] = [];
  private length = 0;
  private voiced = 0;
  private silentSamples = 0;
  private preroll: Float32Array | null = null;
  private history: HistoryItem[] = [];
  private noiseFloor = 0;

  constructor(handlers: SubtitleStreamHandlers, options: Partial<SegmentationOptions> = {}) {
    this.options = { ...TUNED, ...options };
    this.handlers = {
      cleanText: text => text.trim(),
      onState: () => {},
      onError: () => {},
      onDrop: () => {},
      ...handlers,
    };
  }

  reset(): void {
    this.generation++;
    this.buffers = [];
    this.length = 0;
    this.voiced = 0;
    this.silentSamples = 0;
    this.preroll = null;
    this.history = [];
    this.jobs = [];
  }

  /** Resolves when every queued segment has been handled. */
  idle(): Promise<void> {
    return this.chain;
  }

  push(samples: Float32Array): void {
    if (!samples.length) return;
    const o = this.options;
    let energy = 0;
    for (const value of samples) energy += value * value;
    const level = Math.sqrt(energy / samples.length);
    const speech = level >= Math.max(o.threshold, this.noiseFloor * o.floorMultiplier);
    // Follow the room noise only from blocks that are not speech, so speech never raises its own threshold.
    if (o.floorMultiplier > 0 && !speech) this.noiseFloor = this.noiseFloor ? this.noiseFloor * 0.9 + level * 0.1 : level;
    if (!speech && !this.length) {
      this.preroll = samples.slice();
      return;
    }
    if (!this.length && this.preroll) {
      this.buffers.push(this.preroll);
      this.length += this.preroll.length;
      this.preroll = null;
    }
    this.buffers.push(samples.slice());
    this.length += samples.length;
    if (speech) this.voiced += samples.length;
    this.silentSamples = speech ? 0 : this.silentSamples + samples.length;
    const perMs = o.sampleRate / 1000;
    const soft = o.softMs > 0 && this.length >= perMs * o.softMs && this.silentSamples >= perMs * o.softSilenceMs;
    if (soft || this.silentSamples >= perMs * o.silenceMs || this.length >= perMs * o.maxMs) this.flush();
  }

  flush(): void {
    if (!this.length) return;
    const samples = new Float32Array(this.length);
    let offset = 0;
    for (const buffer of this.buffers) {
      samples.set(buffer, offset);
      offset += buffer.length;
    }
    const voiced = this.voiced;
    this.buffers = [];
    this.length = 0;
    this.voiced = 0;
    this.silentSamples = 0;
    if (voiced < (this.options.sampleRate * this.options.minSpeechMs) / 1000) return;
    this.jobs.push({ samples, generation: this.generation });
    while (this.options.maxPending > 0 && this.jobs.length > this.options.maxPending) {
      this.jobs.shift();
      this.handlers.onDrop();
    }
    this.kick();
  }

  private kick(): void {
    if (this.running) return;
    this.running = true;
    this.chain = (async () => {
      try {
        for (let job = this.jobs.shift(); job; job = this.jobs.shift()) await this.process(job);
      } finally {
        this.running = false;
      }
    })();
  }

  private async process({ samples, generation }: Job): Promise<void> {
    const h = this.handlers;
    if (generation !== this.generation) return;
    h.onState('busy');
    try {
      const source = h.cleanText((await h.transcribe(samples)) || '');
      if (generation !== this.generation || !source) return;
      const target = (await h.translate(source, this.history.slice())).trim();
      if (generation !== this.generation) return;
      if (!target) throw new Error('Translation returned no text');
      this.history = [...this.history, { source, target }].slice(-2);
      await h.emit({ text: target, source });
    } catch (error) {
      if (generation === this.generation) h.onError(error);
    } finally {
      if (generation === this.generation && !this.jobs.length) h.onState('idle');
    }
  }
}
