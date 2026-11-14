import { AUDIO_SAMPLE_RATE } from '../../../core/audio';

const BASE_TOKENS = 20;
const TOKENS_PER_SECOND = 12;
const MAX_TOKENS = 200;

/** Speech holds a limited number of tokens per second. A model that loops on noise must stop at this cap. */
export const asrTokenCap = (samples: Float32Array): number =>
  Math.min(MAX_TOKENS, BASE_TOKENS + Math.ceil((samples.length / AUDIO_SAMPLE_RATE) * TOKENS_PER_SECOND));
