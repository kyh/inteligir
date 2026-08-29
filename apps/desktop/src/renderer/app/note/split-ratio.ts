// The split divider's drag: the primary pane's share of the pane row, held as
// session state. The row is measured once at pointer-down rather than on each
// move — the element being measured is the one the drag is resizing.

import {
  useCallback,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

const MIN_RATIO = 0.25;
const MAX_RATIO = 0.75;

interface SplitRatio {
  /** The primary pane's share of the row, MIN_RATIO..MAX_RATIO. */
  ratio: number;
  /** Attached to the pane row; the divider measures against it. */
  paneRowRef: RefObject<HTMLDivElement | null>;
  onDividerPointerDown: (down: ReactPointerEvent<HTMLDivElement>) => void;
}

export function useSplitRatio(): SplitRatio {
  const [ratio, setRatio] = useState(0.5);
  const paneRowRef = useRef<HTMLDivElement | null>(null);
  const onDividerPointerDown = useCallback((down: ReactPointerEvent<HTMLDivElement>): void => {
    down.preventDefault();
    const row = paneRowRef.current;
    if (row === null) return;
    const rect = row.getBoundingClientRect();
    const onMove = (move: PointerEvent): void => {
      const next = (move.clientX - rect.left) / rect.width;
      setRatio(Math.min(MAX_RATIO, Math.max(MIN_RATIO, next)));
    };
    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);
  return { ratio, paneRowRef, onDividerPointerDown };
}
