/** Speech models and the capture pipeline all work on 16 kHz mono audio. */
export const AUDIO_SAMPLE_RATE = 16000;

/** The capture worklet hands over blocks of 250 ms. */
export const CAPTURE_BLOCK_SAMPLES = AUDIO_SAMPLE_RATE / 4;
