import { AutoTokenizer } from '@huggingface/transformers';
import * as ort from 'onnxruntime-web/webgpu';
import { MODEL_CACHE_NAME as CACHE_NAME } from '../../../shared/storage-keys';
import type { Qwen3Parts, TokenizerLike } from './runner';

const FILES = {
  encoder: 'onnx/audio_encoder_q4.onnx',
  embed: 'onnx/embed_tokens_q4.onnx',
  decoder: 'onnx/decoder_model_merged_q4.onnx',
  decoderData: 'onnx/decoder_model_merged_q4.onnx_data',
};

export type FileProgress = (file: string, loaded: number, total: number) => void;

/** Reads a file from the Cache API, or downloads it (with progress) and stores it there. */
async function fetchCached(url: string, file: string, onProgress: FileProgress): Promise<Uint8Array> {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(url);
  if (cached) {
    const bytes = new Uint8Array(await cached.arrayBuffer());
    onProgress(file, bytes.length, bytes.length);
    return bytes;
  }
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Could not download ${file}: HTTP ${response.status}`);
  const total = Number(response.headers.get('content-length')) || 0;
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value as Uint8Array<ArrayBuffer>);
    loaded += value.length;
    onProgress(file, loaded, total || loaded);
  }
  const blob = new Blob(chunks);
  await cache.put(url, new Response(blob, { headers: { 'content-length': String(blob.size) } }));
  return new Uint8Array(await blob.arrayBuffer());
}

export async function loadQwen3(repo: string, host: string, wasmBase: string, gpu: boolean, onProgress: FileProgress): Promise<Qwen3Parts> {
  ort.env.wasm.wasmPaths = wasmBase;
  ort.env.wasm.numThreads = 1;
  const base = `${host.replace(/\/$/, '')}/${repo}/resolve/main/`;
  const fetchFile = (path: string) => fetchCached(base + path, path, onProgress);
  const accelerated: ort.InferenceSession.SessionOptions = { executionProviders: gpu ? ['webgpu', 'wasm'] : ['wasm'], logSeverityLevel: 3 };

  const tokenizer = (await AutoTokenizer.from_pretrained(repo, {
    progress_callback: (event: { status?: string; file?: string; loaded?: number; total?: number }) => {
      if (event.status === 'progress' && event.file) onProgress(event.file, event.loaded ?? 0, event.total ?? 0);
    },
  })) as unknown as TokenizerLike;

  // One file at a time keeps the peak memory low: each buffer is copied into the session and then dropped.
  const encoder = await ort.InferenceSession.create(await fetchFile(FILES.encoder), accelerated);
  // The embedding table is only a lookup: on the GPU it was slower than on WASM in the benchmark.
  const embed = await ort.InferenceSession.create(await fetchFile(FILES.embed), { executionProviders: ['wasm'], logSeverityLevel: 3 });
  const decoderData = await fetchFile(FILES.decoderData);
  // The key-value cache stays in video memory between steps. Copying it to the CPU and back every token is what made decoding slow.
  const preferredOutputLocation: Record<string, 'gpu-buffer'> = {};
  if (gpu) {
    for (let layer = 0; layer < 28; layer++) {
      preferredOutputLocation[`present.${layer}.key`] = 'gpu-buffer';
      preferredOutputLocation[`present.${layer}.value`] = 'gpu-buffer';
    }
  }
  const decoder = await ort.InferenceSession.create(await fetchFile(FILES.decoder), {
    ...accelerated,
    preferredOutputLocation,
    externalData: [{ path: 'decoder_model_merged_q4.onnx_data', data: decoderData }],
  });
  return { ort: ort as never, encoder, embed, decoder, tokenizer } as unknown as Qwen3Parts;
}
