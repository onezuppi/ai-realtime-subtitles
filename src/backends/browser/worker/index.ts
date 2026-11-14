/// <reference lib="webworker" />
import { ASR_ENGINES, MT_ENGINES, type AsrEngineId, type MtEngineId } from '../engines';
import type { ToWorker } from '../protocol';
import { loadPlamoTranslator, type Translator } from './plamo-translator';
import { post } from './post';
import { loadQwen3Transcriber } from './qwen3-transcriber';
import { configureRuntime } from './runtime-env';
import { loadPipelineAsr } from './transformers-asr';
import type { Transcriber } from './transformers-types';

let transcriber: Transcriber | null = null;
let translator: Translator | null = null;
let chain: Promise<void> = Promise.resolve();

async function init(asr: AsrEngineId | null, mt: MtEngineId | null, modelHost: string, wasmBase: string) {
  const started = performance.now();
  const device = configureRuntime(modelHost, wasmBase);
  if (asr) {
    const engine = ASR_ENGINES[asr];
    transcriber = asr === 'qwen3-asr' ? await loadQwen3Transcriber(engine, modelHost, wasmBase, device) : await loadPipelineAsr(engine, device);
  }
  if (mt && mt !== 'none') translator = await loadPlamoTranslator(MT_ENGINES[mt], device);
  post({ type: 'ready', loadMs: Math.round(performance.now() - started), device });
}

async function timed(run: () => Promise<string>): Promise<{ text: string; ms: number }> {
  const started = performance.now();
  const text = await run();
  return { text, ms: Math.round(performance.now() - started) };
}

async function handle(message: ToWorker) {
  if (message.type === 'init') return init(message.asr, message.mt, message.modelHost, message.wasmBase);
  if (message.type === 'transcribe') {
    const speech = transcriber;
    if (!speech) throw new Error('The speech model is not loaded');
    post({ type: 'result', id: message.id, ...(await timed(() => speech(message.samples, message.language))) });
  } else {
    const translate = translator;
    post({ type: 'result', id: message.id, ...(await timed(async () => (translate ? translate(message.text, message.target) : message.text))) });
  }
}

self.addEventListener('message', (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  // One job at a time: the GPU runs them in order anyway.
  chain = chain.then(() =>
    handle(message).catch(error =>
      post({ type: 'error', id: 'id' in message ? message.id : undefined, message: error instanceof Error ? error.message : String(error) }),
    ),
  );
});
