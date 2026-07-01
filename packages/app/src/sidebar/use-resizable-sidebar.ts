import { useCallback, useEffect, useRef, type MouseEvent as ReactMouseEvent } from "react";

import { useDiskState } from "@repo/app/lib/use-disk-state";

// The sidebar width lives in the `--sidebar-width` CSS var (read by the
// @repo/ui Sidebar primitive's `w-(--sidebar-width)`). globals.css seeds a
// :root default; dragging the handle writes an inline override on the root
// element, and the final width persists to the on-disk ui-state store so it
// survives a reload.
const STATE_KEY = "sidebar.width";
const DEFAULT_WIDTH = 256;
const MIN_WIDTH = 180;
const MAX_WIDTH = 480;

function clamp(width: number): number {
  return Math.min(Math.max(width, MIN_WIDTH), MAX_WIDTH);
}

function parseWidth(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? clamp(value) : undefined;
}

// getComputedStyle returns the custom property as authored ("240px"); parse the
// leading number and fall back to the default if it isn't a px value.
function currentWidthPx(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--sidebar-width").trim();
  const px = Number.parseInt(raw, 10);
  return Number.isNaN(px) ? DEFAULT_WIDTH : px;
}

function setCssWidth(width: number): void {
  document.documentElement.style.setProperty("--sidebar-width", `${width}px`);
}

export function useResizableSidebar(): { handleMouseDown: (e: ReactMouseEvent) => void } {
  const [storedWidth, setStoredWidth, loaded] = useDiskState<number>(
    STATE_KEY,
    DEFAULT_WIDTH,
    parseWidth,
  );
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  const resizingRef = useRef(false);

  // Apply the persisted width once ui-state has loaded (overrides the
  // globals.css :root default). Re-applies after a drag too — a no-op, since
  // the CSS var already holds the same value.
  useEffect(() => {
    if (loaded) setCssWidth(storedWidth);
  }, [loaded, storedWidth]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      setCssWidth(clamp(startWidthRef.current + (e.clientX - startXRef.current)));
    };
    const onUp = () => {
      if (!resizingRef.current) return;
      resizingRef.current = false;
      document.documentElement.classList.remove("sidebar-resizing");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setStoredWidth(currentWidthPx());
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [setStoredWidth]);

  const handleMouseDown = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = currentWidthPx();
    // Suppress the primitive's width transition + lock the cursor for the drag.
    document.documentElement.classList.add("sidebar-resizing");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  return { handleMouseDown };
}
