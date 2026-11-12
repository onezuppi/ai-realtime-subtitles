/// <reference lib="webworker" />
import { AutoModelForCausalLM, AutoTokenizer, env, pipeline } from '@huggingface/transformers';
import { ASR_ENGINES, MT_ENGINES, WHISPER_LANGUAGES, type AsrEngineId, type MtEngineId } from './engines';
import type { FromWorker, ToWorker } from './protocol';

const post = (message: FromWorker) => self.postMessage(message);

// Progress of all files of all models in one number.
const files = new Map<string, { loaded: number; total: number }>();
function reportProgress(event: { status?: string; file?: string; loaded?: number; total?: number }) {
  if (event.status !== 'progress' || !event.file || !event.total) return;
  files.set(event.file, { loaded: event.loaded ?? 0, total: event.total });
  let loaded = 0;
  let total = 0;
  for (const part of files.values()) {
    loaded += part.loaded;
    total += part.total;
  }
  post({ type: 'progress', ratio: total ? loaded / total : 0, loadedBytes: loaded, totalBytes: total, file: event.file });
}

type Recognizer = (audio: Float32Array, options: Record<string, unknown>) => Promise<{ text?: string } | { text?: string }[]>;
let recognizer: Recognizer | null = null;
let asrId: AsrEngineId = 'whisper-small';
let translator: { tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>; model: Awaited<ReturnType<typeof AutoModelForCausalLM.from_pretrained>> } | null = null;
let chain: Promise<void> = Promise.resolve();

async function init(asr: AsrEngineId | null, mt: MtEngineId | null, modelHost: string, wasmBase: string) {
  const started = performance.now();
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.remoteHost = modelHost.endsWith('/') ? modelHost : `${modelHost}/`;
  env.useBrowserCache = true;
  const wasm = env.backends.onnx.wasm;
  if (wasm) {
    wasm.wasmPaths = wasmBase;
    wasm.numThreads = 1;
  }
  const device = 'gpu' in navigator ? 'webgpu' : 'wasm';
  if (asr) {
    const engine = ASR_ENGINES[asr];
    if (!engine.available) throw new Error(`${engine.label} is not available in the browser yet`);
    asrId = asr;
    recognizer = (await pipeline('automatic-speech-recognition', engine.repo, {
      // The Whisper encoder in fp32 is the only part that has no smaller file; Cohere runs in q4f16 on WebGPU only.
      dtype: engine.dtype as never,
      device,
      progress_callback: reportProgress,
    })) as unknown as Recognizer;
  }

  if (mt && mt !== 'none') {
    const model = MT_ENGINES[mt];
    const tokenizer = await AutoTokenizer.from_pretrained(model.repo, { progress_callback: reportProgress });
    const causal = await AutoModelForCausalLM.from_pretrained(model.repo, { dtype: model.dtype as never, device, progress_callback: reportProgress });
    translator = { tokenizer, model: causal };
  }
  post({ type: 'ready', loadMs: Math.round(performance.now() - started), device });
}

async function transcribe(samples: Float32Array, language: string): Promise<string> {
  if (!recognizer) throw new Error('The speech model is not loaded');
  const options: Record<string, unknown> = { max_new_tokens: 200 };
  if (language !== 'auto') options.language = asrId === 'whisper-small' ? (WHISPER_LANGUAGES[language] ?? language) : language;
  if (asrId === 'whisper-small') options.task = 'transcribe';
  const result = await recognizer(samples, options);
  return (Array.isArray(result) ? result[0]?.text : result.text)?.trim() ?? '';
}

async function translate(text: string, target: string): Promise<string> {
  if (!translator) return text;
  const { tokenizer, model } = translator;
  const prompt = (tokenizer as unknown as { apply_chat_template: (m: unknown, o: unknown) => string }).apply_chat_template(
    [{ role: 'user', content: text }],
    { tokenize: false, add_generation_prompt: true, target_lang: target },
  );
  const encoded = (tokenizer as unknown as (t: string, o: unknown) => { input_ids: { dims: number[] } })(prompt, { add_special_tokens: false });
  const length = encoded.input_ids.dims[1] ?? 0;
  const output = await (model as unknown as { generate: (o: unknown) => Promise<{ tolist: () => number[][] }> }).generate({
    ...encoded,
    max_new_tokens: 160,
    do_sample: false,
    eos_token_id: [1, 16],
    pad_token_id: 3,
  });
  const ids = (output.tolist()[0] ?? []).slice(length).map(Number);
  return (tokenizer as unknown as { decode: (i: number[], o: unknown) => string }).decode(ids, { skip_special_tokens: true }).trim();
}

self.addEventListener('message', (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  // One job at a time: the GPU runs them in order anyway.
  chain = chain.then(async () => {
    try {
      if (message.type === 'init') {
        await init(message.asr, message.mt, message.modelHost, message.wasmBase);
      } else if (message.type === 'transcribe') {
        const started = performance.now();
        post({ type: 'result', id: message.id, text: await transcribe(message.samples, message.language), ms: Math.round(performance.now() - started) });
      } else if (message.type === 'translate') {
        const started = performance.now();
        post({ type: 'result', id: message.id, text: await translate(message.text, message.target), ms: Math.round(performance.now() - started) });
      }
    } catch (error) {
      post({ type: 'error', id: 'id' in message ? message.id : undefined, message: error instanceof Error ? error.message : String(error) });
    }
  });
});
