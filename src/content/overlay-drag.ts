import type { Box } from './geometry';

/**
 * Starts a pointer gesture on `element`. `move` turns the pointer offset into a new box; `onChange` shows it.
 * The element captures the pointer, so the gesture ends cleanly on release and on cancel.
 */
export function startDrag(
  element: HTMLElement,
  event: PointerEvent,
  start: Box,
  move: (dx: number, dy: number, start: Box) => Box,
  onChange: (box: Box) => void,
  onEnd: () => void,
): void {
  event.preventDefault();
  const originX = event.clientX;
  const originY = event.clientY;
  element.setPointerCapture(event.pointerId);
  element.classList.add('dragging');
  const onMove = (e: PointerEvent) => onChange(move(e.clientX - originX, e.clientY - originY, start));
  const onUp = () => {
    element.classList.remove('dragging');
    element.removeEventListener('pointermove', onMove);
    element.removeEventListener('pointerup', onUp);
    element.removeEventListener('pointercancel', onUp);
    onEnd();
  };
  element.addEventListener('pointermove', onMove);
  element.addEventListener('pointerup', onUp);
  element.addEventListener('pointercancel', onUp);
}
