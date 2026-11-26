import { env } from '@huggingface/transformers';

export type Device = 'webgpu' | 'wasm';

/** Points Transformers.js at the model host and the bundled ONNX Runtime files. Returns the device to run on. */
export function configureRuntime(modelHost: string, wasmBase: string): Device {
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.remoteHost = modelHost.endsWith('/') ? modelHost : `${modelHost}/`;
  env.useBrowserCache = true;
  // ONNX Runtime warns about shape ops it keeps on the CPU. That is by design and only fills the extension's error list.
  env.backends.onnx.logLevel = 'error';
  const wasm = env.backends.onnx.wasm;
  if (wasm) {
    wasm.wasmPaths = wasmBase;
    wasm.numThreads = 1;
  }
  return 'gpu' in navigator ? 'webgpu' : 'wasm';
}
