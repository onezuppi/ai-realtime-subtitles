// Runs in the audio thread. Sends mono blocks of BLOCK samples to the main thread.
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;

const BLOCK = 4000; // 250 ms at 16 kHz

class CaptureProcessor extends AudioWorkletProcessor {
  private block = new Float32Array(BLOCK);
  private filled = 0;

  process(inputs: Float32Array[][]): boolean {
    const channels = inputs[0];
    const first = channels?.[0];
    if (!channels || !first) return true;
    for (let i = 0; i < first.length; i++) {
      let sum = 0;
      for (const channel of channels) sum += channel[i] ?? 0;
      this.block[this.filled++] = sum / channels.length;
      if (this.filled === BLOCK) {
        this.port.postMessage(this.block);
        this.block = new Float32Array(BLOCK);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('capture', CaptureProcessor);
