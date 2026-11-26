/**
 * The native Picture-in-Picture window of a video shows nothing but the video, so the captions would stay on the page.
 * When a video enters it, the video is swapped for a canvas that draws the video and the current caption together.
 */

const MAX_WIDTH = 1280;
const FRAME_MS = 33;

export interface VideoPip {
  setText(text: string): void;
}

/** Breaks the text into lines no wider than maxWidth for the current canvas font. */
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function drawCaption(ctx: CanvasRenderingContext2D, width: number, height: number, text: string) {
  if (!text) return;
  const size = Math.max(16, Math.round(width / 28));
  ctx.font = `600 ${size}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = wrapLines(ctx, text, width * 0.88);
  const lineHeight = size * 1.3;
  const padding = size * 0.5;
  const boxWidth = Math.min(width * 0.94, Math.max(...lines.map(line => ctx.measureText(line).width)) + padding * 2);
  const boxHeight = lines.length * lineHeight + padding;
  const top = height - boxHeight - size * 0.6;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.62)';
  ctx.beginPath();
  ctx.roundRect((width - boxWidth) / 2, top, boxWidth, boxHeight, size * 0.35);
  ctx.fill();
  ctx.fillStyle = '#fff';
  lines.forEach((line, index) => ctx.fillText(line, width / 2, top + padding / 2 + lineHeight * (index + 0.5)));
}

const mirrors = new WeakSet<HTMLVideoElement>();

async function swapForCanvas(source: HTMLVideoElement, getText: () => string) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const scale = Math.min(1, MAX_WIDTH / (source.videoWidth || MAX_WIDTH));
  canvas.width = Math.round((source.videoWidth || 1280) * scale);
  canvas.height = Math.round((source.videoHeight || 720) * scale);
  const paint = () => {
    try {
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    } catch {
      // A protected video cannot be drawn: keep the last frame and the captions.
    }
    drawCaption(ctx, canvas.width, canvas.height, getText());
  };
  paint();
  const mirror = document.createElement('video');
  mirrors.add(mirror);
  mirror.muted = true;
  mirror.srcObject = canvas.captureStream(30);
  await mirror.play();
  // An audible tab is not throttled in the background, so a plain timer keeps the frames coming.
  const timer = setInterval(paint, FRAME_MS);
  mirror.addEventListener('leavepictureinpicture', () => clearInterval(timer), { once: true });
  // Requesting from inside an open window needs no user gesture and replaces the video in that window.
  try {
    await mirror.requestPictureInPicture();
  } catch (error) {
    clearInterval(timer);
    // Without the swap the user still gets the plain video window.
    await source.requestPictureInPicture().catch(() => {});
    throw error;
  }
}

export function watchVideoPip(): VideoPip {
  let text = '';
  const swapped = new WeakSet<HTMLVideoElement>();
  document.addEventListener(
    'enterpictureinpicture',
    event => {
      const video = event.target;
      // The canvas video is ours: it must not be swapped again.
      if (!(video instanceof HTMLVideoElement) || mirrors.has(video) || swapped.has(video)) return;
      swapped.add(video);
      void swapForCanvas(video, () => text)
        .catch(() => {})
        .finally(() => swapped.delete(video));
    },
    true,
  );
  return { setText: value => void (text = value) };
}
