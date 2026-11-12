import { createBackend } from '../backends/create';
import type { Backend } from '../core/backend';
import { SubtitleStream } from '../core/subtitle-stream';
import type { Message, Settings } from '../messages';

const SAMPLE_RATE = 16000;
const send = (message: Message) => void chrome.runtime.sendMessage(message).catch(() => {});

let session: { context: AudioContext; media: MediaStream; backend: Backend; stream: SubtitleStream } | null = null;

async function start(streamId: string, tabId: number, settings: Settings): Promise<void> {
  await stop();
  send({ type: 'status', tabId, state: 'loading' });
  const backend = createBackend(settings.mode);
  await backend.start();

  const media = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
  } as MediaStreamConstraints);
  const context = new AudioContext({ sampleRate: SAMPLE_RATE });
  await context.audioWorklet.addModule(chrome.runtime.getURL('capture-worklet.js'));
  const source = context.createMediaStreamSource(media);
  const node = new AudioWorkletNode(context, 'capture', { numberOfInputs: 1, numberOfOutputs: 0 });
  source.connect(node);
  // Capturing a tab mutes it, so play the sound back.
  source.connect(context.destination);

  const stream = new SubtitleStream({
    transcribe: async samples => (await backend.transcribe(samples, SAMPLE_RATE)).text,
    translate: (text, history) => backend.translate(text, '', settings.targetLang, history),
    emit: caption => send({ type: 'caption', tabId, text: caption.text }),
    onState: state => send({ type: 'status', tabId, state: state === 'busy' ? 'busy' : 'listening' }),
    onError: error => send({ type: 'status', tabId, state: 'error', detail: String(error) }),
  });
  node.port.onmessage = event => stream.push(event.data as Float32Array);
  session = { context, media, backend, stream };
  send({ type: 'status', tabId, state: 'listening' });
}

async function stop(): Promise<void> {
  const current = session;
  session = null;
  if (!current) return;
  current.stream.reset();
  current.media.getTracks().forEach(track => track.stop());
  await current.context.close().catch(() => {});
  await current.backend.stop();
}

chrome.runtime.onMessage.addListener((message: Message) => {
  if (message.type === 'offscreen-start') {
    start(message.streamId, message.tabId, message.settings).catch(error =>
      send({ type: 'status', tabId: message.tabId, state: 'error', detail: String(error) }),
    );
  } else if (message.type === 'offscreen-stop') {
    void stop();
  }
});
