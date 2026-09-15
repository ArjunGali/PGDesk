import { useEffect, useState } from 'react';

export type Breakpoint = 'phone' | 'tablet' | 'wide';

/**
 * One APK, layout chosen from the available width at runtime.
 *
 * Breakpoints are in CSS pixels, which on Android already account for density,
 * so a 7" tablet and a large phone in landscape both land sensibly.
 */
function resolve(width: number): Breakpoint {
  if (width >= 1100) return 'wide';
  if (width >= 700) return 'tablet';
  return 'phone';
}

export function useBreakpoint(): {
  breakpoint: Breakpoint;
  isPhone: boolean;
  isTabletUp: boolean;
  isLandscape: boolean;
  width: number;
} {
  const [state, setState] = useState(() => ({
    width: typeof window === 'undefined' ? 390 : window.innerWidth,
    height: typeof window === 'undefined' ? 800 : window.innerHeight,
  }));

  useEffect(() => {
    let frame = 0;
    const onResize = (): void => {
      // Rotation fires a burst of resizes; coalesce to one paint.
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        setState({ width: window.innerWidth, height: window.innerHeight }),
      );
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  const breakpoint = resolve(state.width);
  return {
    breakpoint,
    isPhone: breakpoint === 'phone',
    isTabletUp: breakpoint !== 'phone',
    isLandscape: state.width > state.height,
    width: state.width,
  };
}
