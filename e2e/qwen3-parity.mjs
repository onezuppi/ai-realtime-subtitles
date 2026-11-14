// Checks the Qwen3-ASR runner in Node: mel features against Transformers.js, then a transcription against llama-server.
// Usage: pnpm exec tsx e2e/qwen3-parity.mjs [seconds]
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { logMel } from '../src/backends/browser/qwen3-asr/mel.ts';
import { transcribeQwen3 } from '../src/backends/browser/qwen3-asr/runner.ts';

const require = createRequire(import.meta.url);
const ortNode = require(require.resolve('onnxruntime-node', { paths: [require.resolve('@huggingface/transformers')] }));
const { AutoTokenizer, WhisperFeatureExtractor, env } = await import('@huggingface/transformers');

const DIR = 'C:/Users/pax20/subtitle-anything-local/models/ae9is/qwen3-asr-0.6b-onnx';
const wav = readFileSync(new URL('./sample.wav', import.meta.url));
const pcm = new Int16Array(wav.buffer, wav.byteOffset + 44, (wav.length - 44) >> 1);
const seconds = Number(process.argv[2] ?? 6);
const samples = Float32Array.from(pcm.subarray(0, seconds * 16000), v => v / 32768);

// 1. Features.
const config = JSON.parse(readFileSync(`${DIR}/preprocessor_config.json`, 'utf8'));
const extractor = new WhisperFeatureExtractor(config);
const reference = (await extractor(samples)).input_features; // [1, 128, 3000], padded
const mine = logMel(samples);
let worst = 0;
for (let m = 0; m < 128; m++) for (let t = 0; t < mine.frames; t++) worst = Math.max(worst, Math.abs(mine.data[m * mine.frames + t] - reference.data[m * reference.dims[2] + t]));
console.log(`mel: ${mine.frames} frames, largest difference to Transformers.js ${worst.toExponential(2)}`);

// 2. Transcription.
env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = 'C:/Users/pax20/subtitle-anything-local/models/';
const tokenizer = await AutoTokenizer.from_pretrained('ae9is/qwen3-asr-0.6b-onnx');
const opts = { executionProviders: ['cpu'] };
const started = performance.now();
const [encoder, embed, decoder] = await Promise.all(['audio_encoder_q4', 'embed_tokens_q4', 'decoder_model_merged_q4'].map(f => ortNode.InferenceSession.create(`${DIR}/onnx/${f}.onnx`, opts)));
console.log(`sessions loaded in ${Math.round(performance.now() - started)} ms`);
const parts = { ort: ortNode, encoder, embed, decoder, tokenizer };
for (const language of [null, 'en']) {
  const t0 = performance.now();
  const result = await transcribeQwen3(parts, samples, language);
  console.log(`runner [${language ?? 'auto'}] ${Math.round(performance.now() - t0)} ms:`, JSON.stringify(result));
}

// 3. The same audio through llama-server.
try {
  const body = { model: 'x', messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: wavBase64(samples), format: 'wav' } }] }], max_tokens: 200, temperature: 0 };
  const t0 = performance.now();
  const reply = await (await fetch('http://127.0.0.1:8083/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
  console.log(`llama-server ${Math.round(performance.now() - t0)} ms:`, JSON.stringify(reply.choices?.[0]?.message?.content ?? reply));
} catch (error) {
  console.log('llama-server not reachable:', String(error));
}

function wavBase64(floats) {
  const buffer = Buffer.alloc(44 + floats.length * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + floats.length * 2, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(16000, 24);
  buffer.writeUInt32LE(32000, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(floats.length * 2, 40);
  floats.forEach((v, i) => buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), 44 + i * 2));
  return buffer.toString('base64');
}
