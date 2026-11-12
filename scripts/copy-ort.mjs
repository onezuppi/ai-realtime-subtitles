// Copies the ONNX Runtime WebAssembly files into dist/ort. A browser extension cannot load them from a CDN.
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const FILES = ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'];

const pnpmDir = 'node_modules/.pnpm';
const folder = readdirSync(pnpmDir).find(name => name.startsWith('onnxruntime-web@'));
const source = folder ? join(pnpmDir, folder, 'node_modules/onnxruntime-web/dist') : 'node_modules/onnxruntime-web/dist';
if (!existsSync(source)) throw new Error('onnxruntime-web is not installed. Run "pnpm install".');

mkdirSync('dist/ort', { recursive: true });
for (const file of FILES) cpSync(join(source, file), join('dist/ort', file));
console.log(`Copied ${FILES.length} ONNX Runtime files to dist/ort`);
