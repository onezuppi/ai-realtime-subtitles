import type { Settings } from '../shared/settings';

/** What the sections of the settings page share: the current settings, saving, and a status line. */
export interface OptionsContext {
  settings(): Settings;
  /** Saves only what changed, so another open page's choices are not overwritten. */
  update(patch: Partial<Settings>): Promise<void>;
  /** Shows a short message next to the page title. */
  say(text: string, ms?: number): void;
  /** Calls `listener` when the settings change on this page or on another one. */
  onChange(listener: () => void): void;
}
