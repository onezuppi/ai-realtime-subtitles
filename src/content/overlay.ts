import { DEFAULT_SETTINGS, loadSettings, type Message, type Settings } from '../messages';
import { clampBox, defaultBox, fontSizeFor, MIN_WIDTH, OVERLAY_BOX_KEY as KEY, type Box } from './geometry';
const HIDE_MS = (text: string) => Math.min(8000, Math.max(3000, text.length * 80));

// The script can be injected more than once: keep a single overlay and a single listener.
const guard = globalThis as unknown as { __subtitleOverlay?: boolean };

async function loadBox(): Promise<Box> {
  const stored = (await chrome.storage.local.get(KEY))[KEY] as Box | undefined;
  return clampBox(stored ?? defaultBox(innerWidth, innerHeight), innerWidth, innerHeight);
}

function createOverlay(initial: Box, initialSettings: Settings) {
  const host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>
      .box { position: fixed; pointer-events: auto; touch-action: none; cursor: grab; display: none;
        padding: .45em .8em; border-radius: .5em; box-sizing: border-box; color: #fff; text-align: center;
        font: 600 16px/1.35 system-ui, sans-serif; text-shadow: 0 1px 2px rgba(0,0,0,.8);
        background: rgba(0,0,0,var(--opacity)); backdrop-filter: blur(4px); user-select: none; }
      .box.dragging { cursor: grabbing; }
      .grip { position: absolute; right: 2px; bottom: 2px; width: 14px; height: 14px; cursor: nwse-resize; opacity: 0;
        background: linear-gradient(135deg, transparent 50%, rgba(255,255,255,.8) 50%); border-radius: 0 0 .4em 0; }
      .box:hover .grip { opacity: 1; }
    </style>
    <div class="box" part="box"><span class="text"></span><div class="grip"></div></div>`;
  document.documentElement.append(host);

  const box = root.querySelector<HTMLDivElement>('.box')!;
  const text = root.querySelector<HTMLSpanElement>('.text')!;
  const grip = root.querySelector<HTMLDivElement>('.grip')!;
  let geometry = initial;
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
  const save = () => void chrome.storage.local.set({ [KEY]: geometry });

  const drag = (event: PointerEvent, move: (dx: number, dy: number, start: Box) => Box) => {
    event.preventDefault();
    const start = { ...geometry };
    const originX = event.clientX;
    const originY = event.clientY;
    box.classList.add('dragging');
    const onMove = (e: PointerEvent) => {
      geometry = move(e.clientX - originX, e.clientY - originY, start);
      apply();
    };
    const onUp = () => {
      box.classList.remove('dragging');
      removeEventListener('pointermove', onMove);
      removeEventListener('pointerup', onUp);
      save();
    };
    addEventListener('pointermove', onMove);
    addEventListener('pointerup', onUp);
  };

  box.addEventListener('pointerdown', event => {
    if (event.target === grip) return;
    drag(event, (dx, dy, start) => ({ ...start, x: start.x + dx, y: start.y + dy }));
  });
  grip.addEventListener('pointerdown', event => {
    event.stopPropagation();
    drag(event, (dx, _dy, start) => ({ ...start, width: Math.max(MIN_WIDTH, start.width + dx) }));
  });
  addEventListener('resize', apply);
  apply();

  // The caption fades after a few seconds, but stays while the pointer is on it, so it can be moved and resized.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const scheduleHide = () => {
    clearTimeout(timer);
    if (text.textContent) timer = setTimeout(() => (box.style.display = 'none'), HIDE_MS(text.textContent));
  };
  box.addEventListener('pointerenter', () => clearTimeout(timer));
  box.addEventListener('pointerleave', scheduleHide);
  return {
    applySettings(settings: Settings) {
      fontScale = settings.fontScale;
      box.style.setProperty('--opacity', String(settings.opacity));
      apply();
    },
    resetBox() {
      geometry = defaultBox(innerWidth, innerHeight);
      apply();
    },
    show(value: string) {
      text.textContent = value;
      box.style.display = value ? 'block' : 'none';
      apply();
      scheduleHide();
    },
  };
}

if (!guard.__subtitleOverlay) {
  guard.__subtitleOverlay = true;
  void Promise.all([loadBox(), loadSettings()]).then(([initial, settings]) => {
    const overlay = createOverlay(initial, settings);
    chrome.runtime.onMessage.addListener((message: Message) => {
      if (message.type === 'caption') overlay.show(message.text);
    });
    // Changes made in the settings page apply at once, without reloading the tab.
    chrome.storage.onChanged.addListener(changes => {
      if (changes.settings) overlay.applySettings({ ...DEFAULT_SETTINGS, ...(changes.settings.newValue as Partial<Settings>) });
      if (KEY in changes && !changes[KEY]?.newValue) overlay.resetBox();
    });
  });
}
