import type { Settings } from '../shared/settings';
import { OVERLAY_BOX_KEY } from '../shared/storage-keys';
import { clampBox, defaultBox, fontSizeFor, hideDelayMs, MIN_WIDTH, type Box } from './geometry';
import { startDrag } from './overlay-drag';
import { OVERLAY_HTML } from './overlay-template';
import { openCaptionWindow, pipSupported, type CaptionWindow } from './pip';
import { watchVideoPip } from './video-pip';

export interface OverlayView {
  applySettings(settings: Settings): void;
  resetBox(): void;
  show(text: string): void;
}

/** The caption box in the page: moves, resizes and hides itself. Picture-in-Picture mirrors its text. */
export function createOverlayView(initial: Box, initialSettings: Settings): OverlayView {
  const host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = OVERLAY_HTML;
  document.documentElement.append(host);

  const box = root.querySelector<HTMLDivElement>('.box')!;
  const text = root.querySelector<HTMLSpanElement>('.text')!;
  const grip = root.querySelector<HTMLDivElement>('.grip')!;
  const pipButton = root.querySelector<HTMLButtonElement>('.pip')!;
  let geometry = initial;
  let pipWindow: CaptionWindow | null = null;
  let lastText = '';
  const videoPip = watchVideoPip();
  let fontScale = initialSettings.fontScale;
  box.style.setProperty('--opacity', String(initialSettings.opacity));

  const apply = () => {
    geometry = clampBox(geometry, innerWidth, innerHeight, box.offsetHeight || 40);
    Object.assign(box.style, {
      left: `${geometry.x}px`,
      top: `${geometry.y}px`,
      width: `${geometry.width}px`,
      fontSize: `${Math.round(fontSizeFor(geometry.width) * fontScale)}px`,
    });
  };
  const gesture = (event: PointerEvent, move: (dx: number, dy: number, start: Box) => Box) =>
    startDrag(box, event, { ...geometry }, move, next => { geometry = next; apply(); }, () => void chrome.storage.local.set({ [OVERLAY_BOX_KEY]: geometry }));

  if (pipSupported()) pipButton.style.display = 'block';
  pipButton.addEventListener('pointerdown', event => event.stopPropagation());
  pipButton.addEventListener('click', async () => {
    if (pipWindow) return pipWindow.close();
    try {
      pipWindow = await openCaptionWindow(() => {
        pipWindow = null;
        pipButton.setAttribute('aria-pressed', 'false');
      }, lastText);
    } catch {
      pipWindow = null;
    }
    pipButton.setAttribute('aria-pressed', String(pipWindow !== null));
  });
  box.addEventListener('pointerdown', event => {
    if (event.target === grip || pipButton.contains(event.target as Node)) return;
    gesture(event, (dx, dy, start) => ({ ...start, x: start.x + dx, y: start.y + dy }));
  });
  grip.addEventListener('pointerdown', event => {
    event.stopPropagation();
    gesture(event, (dx, _dy, start) => ({ ...start, width: Math.max(MIN_WIDTH, start.width + dx) }));
  });
  addEventListener('resize', apply);
  apply();

  // The caption fades after a few seconds, but stays while the pointer is on it, so it can be moved and resized.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const scheduleHide = () => {
    clearTimeout(timer);
    if (!text.textContent) return;
    timer = setTimeout(() => {
      box.style.display = 'none';
      pipWindow?.setText('');
      videoPip.setText('');
    }, hideDelayMs(text.textContent));
  };
  box.addEventListener('pointerenter', () => clearTimeout(timer));
  box.addEventListener('pointerleave', scheduleHide);

  return {
    applySettings(settings) {
      fontScale = settings.fontScale;
      box.style.setProperty('--opacity', String(settings.opacity));
      apply();
    },
    resetBox() {
      geometry = defaultBox(innerWidth, innerHeight);
      apply();
    },
    show(value) {
      lastText = value;
      pipWindow?.setText(value);
      videoPip.setText(value);
      text.textContent = value;
      box.style.display = value ? 'block' : 'none';
      apply();
      scheduleHide();
    },
  };
}
