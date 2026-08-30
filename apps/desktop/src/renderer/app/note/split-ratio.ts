// The split divider's drag: the primary pane's share of the pane row, written
// straight onto the row as a custom property. It never becomes React state —
// nothing under the workspace is memoized, so a per-frame ratio would redraw
// both editor panes, the notes rail, the top bar and the panel to move one
// edge. The row is measured once at pointer-down rather than on each move: the
// element being measured is the one the drag is resizing.

import { useCallback, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

const MIN_RATIO = 0.25;
const MAX_RATIO = 0.75;
const RATIO_PROPERTY = "--split-primary";

/** The primary pane's width while a split is open: the drag's own property,
 * falling back to an even split before the divider has been touched. */
export const SPLIT_PRIMARY_WIDTH = `var(${RATIO_PROPERTY}, 50%)`;

interface SplitRatio {
  /** Attached to the pane row: the drag measures against it and writes the
   * ratio onto it. */
  paneRowRef: RefObject<HTMLDivElement | null>;
  /** Spread onto the divider. Move and up are the DIVIDER's own handlers under
   * pointer capture, so a pointer released outside the window, or a divider
   * that unmounts mid-drag, takes them with it. */
  dividerProps: {
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  };
}

export function useSplitRatio(): SplitRatio {
  const paneRowRef = useRef<HTMLDivElement | null>(null);
  // The row's geometry for the drag in flight; null when none is.
  const dragRef = useRef<{ left: number; width: number } | null>(null);

  const onPointerDown = useCallback((down: ReactPointerEvent<HTMLDivElement>): void => {
    const row = paneRowRef.current;
    if (row === null) return;
    down.preventDefault();
    const { left, width } = row.getBoundingClientRect();
    dragRef.current = { left, width };
    down.currentTarget.setPointerCapture(down.pointerId);
  }, []);

  const onPointerMove = useCallback((move: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    const row = paneRowRef.current;
    if (drag === null || row === null) return;
    const share = (move.clientX - drag.left) / drag.width;
    const ratio = Math.min(MAX_RATIO, Math.max(MIN_RATIO, share));
    row.style.setProperty(RATIO_PROPERTY, `${String(ratio * 100)}%`);
  }, []);

  const onPointerUp = useCallback((up: ReactPointerEvent<HTMLDivElement>): void => {
    dragRef.current = null;
    up.currentTarget.releasePointerCapture(up.pointerId);
  }, []);

  return { paneRowRef, dividerProps: { onPointerDown, onPointerMove, onPointerUp } };
}
