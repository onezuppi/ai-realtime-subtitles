import type { Message } from '../shared/messages';
import { loadSettings, watchSettings } from '../shared/settings-store';
import { OVERLAY_BOX_KEY } from '../shared/storage-keys';
import { clampBox, defaultBox, type Box } from './geometry';
import { createOverlayView } from './overlay-view';

// The script can be injected more than once: keep a single overlay and a single listener.
const guard = globalThis as unknown as { __subtitleOverlay?: boolean };

async function loadBox(): Promise<Box> {
  const stored = (await chrome.storage.local.get(OVERLAY_BOX_KEY))[OVERLAY_BOX_KEY] as Box | undefined;
  return clampBox(stored ?? defaultBox(innerWidth, innerHeight), innerWidth, innerHeight);
}

if (!guard.__subtitleOverlay) {
  guard.__subtitleOverlay = true;
  void Promise.all([loadBox(), loadSettings()]).then(([initial, settings]) => {
    const overlay = createOverlayView(initial, settings);
    chrome.runtime.onMessage.addListener((message: Message) => {
      if (message.type === 'caption') overlay.show(message.text);
    });
    // Changes made in the settings page apply at once, without reloading the tab.
    watchSettings(overlay.applySettings);
    chrome.storage.onChanged.addListener(changes => {
      if (OVERLAY_BOX_KEY in changes && !changes[OVERLAY_BOX_KEY]?.newValue) overlay.resetBox();
    });
  });
}
