/** Models that can run inside the browser. One list feeds the worker, the settings page and the README table. */

export type AsrEngineId = 'whisper-small' | 'cohere' | 'qwen3-asr';
export type MtEngineId = 'plamo-0.8b' | 'none';

export interface AsrEngine {
  id: AsrEngineId;
  label: string;
  /** Hugging Face repository. */
  repo: string;
  /** Precision per model file, or one precision for all. */
  dtype: string | Record<string, string>;
  /** Approximate download size in MB. */
  sizeMB: number;
  /** The model cannot detect the language and needs it from the settings. */
  needsLanguage: boolean;
  languages: string;
  /** Language codes the model can recognise. Missing means "many, detected by itself". */
  sourceCodes?: string[];
  /** False while the engine has no runner. */
  available: boolean;
  note: string;
}

export interface MtEngine {
  id: MtEngineId;
  label: string;
  repo: string;
  dtype: string;
  sizeMB: number;
  languages: string;
  available: boolean;
  note: string;
}

export const ASR_ENGINES: Record<AsrEngineId, AsrEngine> = {
  'whisper-small': {
    id: 'whisper-small',
    label: 'Whisper small',
    repo: 'onnx-community/whisper-small',
    dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
    sizeMB: 560,
    needsLanguage: false,
    languages: '99 languages, detects the language by itself',
    available: true,
    note: 'Smallest download. Works without WebGPU, but slowly.',
  },
  cohere: {
    id: 'cohere',
    label: 'Cohere Transcribe 2B',
    repo: 'onnx-community/cohere-transcribe-03-2026-ONNX',
    dtype: 'q4f16',
    sizeMB: 1540,
    needsLanguage: true,
    languages: '14 languages (no Russian), the language must be chosen',
    sourceCodes: ['ar', 'de', 'el', 'en', 'es', 'fr', 'it', 'ja', 'ko', 'nl', 'pl', 'pt', 'vi', 'zh'],
    available: true,
    note: 'Needs WebGPU. Weaker on Chinese in our earlier tests.',
  },
  'qwen3-asr': {
    id: 'qwen3-asr',
    label: 'Qwen3-ASR 0.6B',
    repo: 'ae9is/qwen3-asr-0.6b-onnx',
    dtype: 'q4',
    sizeMB: 1720,
    needsLanguage: false,
    languages: '30 languages, detects the language by itself',
    available: true,
    note: 'Needs WebGPU. Runs on our own runner, because Transformers.js cannot run this model.',
  },
};

export const MT_ENGINES: Record<MtEngineId, MtEngine> = {
  'plamo-0.8b': {
    id: 'plamo-0.8b',
    label: 'PLaMo 3 Translate 0.8B',
    repo: 'TeamFlaxia/plamo-3-translate-0.8b-onnx',
    dtype: 'q4f16',
    sizeMB: 675,
    languages: 'Translates to English and Russian',
    available: true,
    note: 'Needs WebGPU. Translates each phrase on its own, without the earlier phrases as context.',
  },
  none: {
    id: 'none',
    label: 'No translation',
    repo: '',
    dtype: '',
    sizeMB: 0,
    languages: 'Shows the recognised text as it is',
    available: true,
    note: 'Subtitles in the language of the audio.',
  },
};

/** Whisper takes language names, not codes. */
export const WHISPER_LANGUAGES: Record<string, string> = {
  en: 'english', ru: 'russian', zh: 'chinese', es: 'spanish', ja: 'japanese', de: 'german', fr: 'french',
  it: 'italian', pt: 'portuguese', ko: 'korean', ar: 'arabic', nl: 'dutch', pl: 'polish', tr: 'turkish', uk: 'ukrainian',
};

/** Source languages the settings offer. Cohere supports only some of them. */
export const SOURCE_LANGUAGES: { code: string; label: string }[] = [
  { code: 'auto', label: 'Detect automatically' },
  { code: 'zh', label: 'Chinese' },
  { code: 'es', label: 'Spanish' },
  { code: 'ja', label: 'Japanese' },
  { code: 'de', label: 'German' },
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'French' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'ko', label: 'Korean' },
  { code: 'ru', label: 'Russian' },
];

export const totalDownloadMB = (asr: AsrEngineId, mt: MtEngineId) => ASR_ENGINES[asr].sizeMB + MT_ENGINES[mt].sizeMB;
