import { useCallback, useRef } from 'react';

/**
 * Long press for the tenant context menu (Vacate / Switch Room / Info).
 *
 * Cancels on movement so a scroll is never mistaken for a press, and
 * suppresses the click that would otherwise follow the release.
 */
export function useLongPress(
  onLongPress: (event: { x: number; y: number }) => void,
  { delay = 480, moveTolerance = 12 }: { delay?: number; moveTolerance?: number } = {},
) {
  const timer = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const clear = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    origin.current = null;
  }, []);

  const start = useCallback(
    (event: React.PointerEvent) => {
      // Ignore secondary buttons and stylus barrel taps.
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      fired.current = false;
      origin.current = { x: event.clientX, y: event.clientY };
      timer.current = window.setTimeout(() => {
        fired.current = true;
        if (origin.current) onLongPress(origin.current);
        // A short vibration confirms the menu without a visual jump.
        navigator.vibrate?.(18);
      }, delay);
    },
    [delay, onLongPress],
  );

  const move = useCallback(
    (event: React.PointerEvent) => {
      if (!origin.current) return;
      const dx = Math.abs(event.clientX - origin.current.x);
      const dy = Math.abs(event.clientY - origin.current.y);
      if (dx > moveTolerance || dy > moveTolerance) clear();
    },
    [clear, moveTolerance],
  );

  return {
    handlers: {
      onPointerDown: start,
      onPointerMove: move,
      onPointerUp: clear,
      onPointerCancel: clear,
      onPointerLeave: clear,
      onContextMenu: (event: React.MouseEvent) => event.preventDefault(),
      onClickCapture: (event: React.MouseEvent) => {
        if (fired.current) {
          event.preventDefault();
          event.stopPropagation();
          fired.current = false;
        }
      },
    },
  };
}
