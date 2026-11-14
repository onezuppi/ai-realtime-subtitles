import type { BackendKind } from '../core/backend';
import { ASR_ENGINES, MT_ENGINES, type AsrEngineId, type MtEngineId } from '../backends/browser/engines';

export interface Settings {
  mode: BackendKind;
  /** Show a translation instead of the recognised text. Off means plain subtitles in the language of the audio. */
  translate: boolean;
  /** Target language of the translation, for example "en" or "ru". */
  targetLang: string;
  /** Opacity of the caption background, 0.1 to 1. */
  opacity: number;
  /** Multiplier of the caption text size, 0.6 to 2. */
  fontScale: number;
  /** Development only: listen to the default microphone instead of the tab (used with a fake audio device in tests). */
  debugAudio?: 'microphone';
  /** Browser mode: speech model. */
  asrEngine: AsrEngineId;
  /** Browser mode: translation model. */
  mtEngine: MtEngineId;
  /** Browser mode: language of the audio, or "auto". Some models cannot detect it. */
  sourceLang: string;
  /** Browser mode: where models are downloaded from. A mirror can replace Hugging Face. */
  modelHost: string;
}

export const DEFAULT_SETTINGS: Settings = {
  mode: 'http',
  translate: true,
  targetLang: 'en',
  opacity: 0.55,
  fontScale: 1,
  asrEngine: 'whisper-small',
  mtEngine: 'plamo-0.8b',
  sourceLang: 'auto',
  modelHost: 'https://huggingface.co',
};

const MODES: BackendKind[] = ['browser', 'http', 'native'];
const clamp = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
const text = (value: unknown, fallback: string) => (typeof value === 'string' && value.trim() ? value : fallback);

/** Turns whatever is stored into valid settings: unknown ids and out-of-range numbers fall back to the defaults. */
export function normalizeSettings(raw: unknown): Settings {
  const stored = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  const settings: Settings = {
    mode: MODES.includes(stored.mode as BackendKind) ? (stored.mode as BackendKind) : d.mode,
    translate: typeof stored.translate === 'boolean' ? stored.translate : d.translate,
    targetLang: text(stored.targetLang, d.targetLang),
    opacity: clamp(stored.opacity, 0.1, 1, d.opacity),
    fontScale: clamp(stored.fontScale, 0.6, 2, d.fontScale),
    asrEngine: (stored.asrEngine as AsrEngineId) in ASR_ENGINES ? (stored.asrEngine as AsrEngineId) : d.asrEngine,
    mtEngine: (stored.mtEngine as MtEngineId) in MT_ENGINES ? (stored.mtEngine as MtEngineId) : d.mtEngine,
    sourceLang: text(stored.sourceLang, d.sourceLang),
    modelHost: text(stored.modelHost, d.modelHost),
  };
  if (stored.debugAudio === 'microphone') settings.debugAudio = 'microphone';
  return settings;
}

/** The translation model that actually runs: none when the user wants plain subtitles. */
export const effectiveMtEngine = (settings: Settings): MtEngineId => (settings.translate ? settings.mtEngine : 'none');
