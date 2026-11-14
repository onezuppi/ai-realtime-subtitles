// Manual check against running llama-servers: pnpm smoke:llama <file.wav>
import { readFileSync } from 'node:fs';
import { LlamaBackend } from '../../src/backends/llama/llama-backend';

const file = process.argv[2];
if (!file) throw new Error('usage: pnpm smoke:llama <16 kHz mono 16-bit wav>');
const wav = readFileSync(file);
const pcm = new Int16Array(wav.buffer.slice(wav.byteOffset + 44, wav.byteOffset + wav.length - ((wav.length - 44) % 2)));
const samples = Float32Array.from(pcm, value => value / 32768);

const backend = new LlamaBackend('http');
await backend.start();
const started = performance.now();
const heard = await backend.transcribe(samples.subarray(0, 16000 * 6), 16000);
const asrMs = Math.round(performance.now() - started);
const translated = await backend.translate(heard.text, heard.language, 'en', []);
console.log(JSON.stringify({ asrMs, totalMs: Math.round(performance.now() - started), heard, translated }, null, 2));
