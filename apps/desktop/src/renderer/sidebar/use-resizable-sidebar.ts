import { useCallback, useEffect, useRef, type MouseEvent as ReactMouseEvent } from "react";

// The sidebar width lives in the `--sidebar-width` CSS var (read by the
// @repo/ui Sidebar primitive's `w-(--sidebar-width)`). globals.css seeds a
// :root default; dragging the handle writes an inline override on the root
// element, and we persist the last width so it survives a reload.
const STORAGE_KEY = "inteligir:sidebar-width";
const DEFAULT_WIDTH = 240;
const MIN_WIDTH = 180;
const MAX_WIDTH = 480;

function clamp(width: number): number {
  return Math.min(Math.max(width, MIN_WIDTH), MAX_WIDTH);
}

// getComputedStyle returns the custom property as authored ("240px"); parse the
// leading number and fall back to the default if it isn't a px value.
function currentWidthPx(): number {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--sidebar-width")
    .trim();
  const px = Number.parseInt(raw, 10);
  return Number.isNaN(px) ? DEFAULT_WIDTH : px;
}

function readStoredWidth(): number {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? DEFAULT_WIDTH : clamp(parsed);
}

function setWidth(width: number): void {
  document.documentElement.style.setProperty("--sidebar-width", `${width}px`);
}

export function useResizableSidebar(): { handleMouseDown: (e: ReactMouseEvent) => void } {
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  const resizingRef = useRef(false);

  // Apply the persisted width on mount (overrides the globals.css :root default).
  useEffect(() => {
    setWidth(readStoredWidth());
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      setWidth(clamp(startWidthRef.current + (e.clientX - startXRef.current)));
    };
    const onUp = () => {
      if (!resizingRef.current) return;
      resizingRef.current = false;
      document.documentElement.classList.remove("sidebar-resizing");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.localStorage.setItem(STORAGE_KEY, String(currentWidthPx()));
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, []);

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
