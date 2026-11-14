import { createBackend } from '../backends/create';
import { AUDIO_SAMPLE_RATE } from '../core/audio';
import { SubtitleStream } from '../core/subtitle-stream';
import type { Message } from '../shared/messages';
import type { Settings } from '../shared/settings';

const send = (message: Message) => void chrome.runtime.sendMessage(message).catch(() => {});

export interface CaptureSession {
  stop(): Promise<void>;
}

/** Audio of the tab (or the microphone when `streamId` is empty) -> speech model -> captions sent to the page. */
export async function startCapture(streamId: string, tabId: number, settings: Settings): Promise<CaptureSession> {
  let stage = 'capture';
  const cleanup: Array<() => void | Promise<unknown>> = [];
  const release = async () => {
    for (const undo of cleanup.reverse()) await Promise.resolve(undo()).catch(() => {});
  };
  try {
    // A tab stream id expires within seconds, so take the stream before the slow model loading.
    const fromTab = streamId !== '';
    const media = await navigator.mediaDevices.getUserMedia(
      fromTab
        ? ({ audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } } } as MediaStreamConstraints)
        : { audio: true },
    );
    cleanup.push(() => media.getTracks().forEach(track => track.stop()));
    stage = 'models';
    const backend = createBackend(settings);
    await backend.start(progress =>
      send({ type: 'status', tabId, state: 'loading', detail: `Loading models: ${Math.round(progress.ratio * 100)}%` }),
    );
    cleanup.push(() => backend.stop());
    stage = 'audio';
    const context = new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE });
    cleanup.push(() => context.close());
    await context.audioWorklet.addModule(chrome.runtime.getURL('capture-worklet.js'));
    const source = context.createMediaStreamSource(media);
    const node = new AudioWorkletNode(context, 'capture', { numberOfInputs: 1, numberOfOutputs: 0 });
    source.connect(node);
    // Capturing a tab mutes it, so play the sound back.
    if (fromTab) source.connect(context.destination);

    const stream = new SubtitleStream({
      transcribe: async samples => (await backend.transcribe(samples, AUDIO_SAMPLE_RATE)).text,
      // Plain subtitles: no translation model is asked, so a missing translation server does not matter.
      translate: (text, history) => (settings.translate ? backend.translate(text, '', settings.targetLang, history) : Promise.resolve(text)),
      emit: caption => send({ type: 'caption', tabId, text: caption.text }),
      onState: state => send({ type: 'status', tabId, state: state === 'busy' ? 'busy' : 'listening' }),
      onError: error => send({ type: 'status', tabId, state: 'error', detail: String(error) }),
    });
    node.port.onmessage = event => stream.push(event.data as Float32Array);
    send({ type: 'status', tabId, state: 'listening' });
    return {
      async stop() {
        stream.reset();
        await release();
      },
    };
  } catch (error) {
    // Release everything taken so far, otherwise the tab stays captured and every retry fails.
    await release();
    throw new Error(`${stage}: ${error}`);
  }
}
