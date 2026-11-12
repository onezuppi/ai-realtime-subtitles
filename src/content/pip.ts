/** Captions in a Picture-in-Picture window (Document Picture-in-Picture API, Chromium 116 and newer). */

interface DocumentPip {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
  window: Window | null;
}

const api = () => (window as unknown as { documentPictureInPicture?: DocumentPip }).documentPictureInPicture;

export const pipSupported = () => api() !== undefined;

export interface CaptionWindow {
  setText(text: string): void;
  close(): void;
}

const STYLE = `
  html, body { margin: 0; height: 100%; background: #0b0b0f; }
  body { display: grid; place-items: center; padding: 12px; box-sizing: border-box; overflow: hidden; }
  p { margin: 0; color: #fff; text-align: center; font: 600 clamp(16px, 5.2vw, 56px)/1.3 system-ui, sans-serif; text-wrap: balance; }
  p:empty::before { content: "Subtitles appear here"; opacity: .35; font-weight: 500; }
`;

/** Must be called from a user gesture, such as a click. Resolves to null when the browser has no such API. */
export async function openCaptionWindow(onClosed: () => void, initial = ''): Promise<CaptionWindow | null> {
  const pip = api();
  if (!pip) return null;
  const win = await pip.requestWindow({ width: 520, height: 150 });
  const style = win.document.createElement('style');
  style.textContent = STYLE;
  const line = win.document.createElement('p');
  line.textContent = initial;
  win.document.head.append(style);
  win.document.body.append(line);
  win.addEventListener('pagehide', onClosed);
  return {
    setText: text => void (line.textContent = text),
    close: () => win.close(),
  };
}
