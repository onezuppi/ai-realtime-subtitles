import { describe, expect, it } from 'vitest';
import { clampBox, defaultBox, fontSizeFor, MIN_WIDTH } from '../src/content/geometry';

describe('overlay geometry', () => {
  it('centres the default box near the bottom', () => {
    expect(defaultBox(1000, 500)).toEqual({ x: 200, y: 400, width: 600 });
  });

  it('keeps a dragged box inside the viewport', () => {
    expect(clampBox({ x: -50, y: 9999, width: 300 }, 1000, 500, 50)).toEqual({ x: 0, y: 450, width: 300 });
    expect(clampBox({ x: 900, y: 10, width: 300 }, 1000, 500)).toEqual({ x: 700, y: 10, width: 300 });
  });

  it('enforces the minimum width and the viewport width', () => {
    expect(clampBox({ x: 0, y: 0, width: 10 }, 1000, 500).width).toBe(MIN_WIDTH);
    expect(clampBox({ x: 0, y: 0, width: 5000 }, 1000, 500).width).toBe(1000);
  });

  it('scales the font with the width', () => {
    expect(fontSizeFor(280)).toBe(12);
    expect(fontSizeFor(840)).toBe(30);
  });
});
