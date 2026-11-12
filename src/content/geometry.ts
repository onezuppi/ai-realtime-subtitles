export interface Box {
  /** Left edge in px. */
  x: number;
  /** Top edge in px. */
  y: number;
  /** Width in px. The font size follows the width. */
  width: number;
}

export const MIN_WIDTH = 160;
export const FONT_PER_WIDTH = 1 / 28;

export const DEFAULT_OPACITY = 0.55;

/** Default box: centred, near the bottom, 60% of the viewport width. */
export function defaultBox(viewportWidth: number, viewportHeight: number): Box {
  const width = Math.max(MIN_WIDTH, Math.round(viewportWidth * 0.6));
  return { x: Math.round((viewportWidth - width) / 2), y: Math.round(viewportHeight * 0.8), width };
}

/** Keep the box inside the viewport and at least MIN_WIDTH wide. */
export function clampBox(box: Box, viewportWidth: number, viewportHeight: number, height = 40): Box {
  const width = Math.min(Math.max(box.width, MIN_WIDTH), Math.max(MIN_WIDTH, viewportWidth));
  return {
    width,
    x: Math.min(Math.max(box.x, 0), Math.max(0, viewportWidth - width)),
    y: Math.min(Math.max(box.y, 0), Math.max(0, viewportHeight - height)),
  };
}

export const fontSizeFor = (width: number) => Math.max(12, Math.round(width * FONT_PER_WIDTH));
