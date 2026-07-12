import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

import { useDiskState } from "@renderer/lib/use-disk-state";

// The sidebar width lives in the `--sidebar-width` CSS var. The stock
// SidebarProvider pins a default inline on its `[data-slot="sidebar-wrapper"]`
// element, so writes MUST land on that element to win the cascade — a :root
// write would be shadowed. Scoping the write there also keeps per-drag style
// invalidation inside the sidebar subtree instead of the whole document.
// Dragging writes the var directly; the final width persists to the on-disk
// ui-state store so it survives a reload.
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

function sidebarWrapper(): HTMLElement | null {
  const el = document.querySelector('[data-slot="sidebar-wrapper"]');
  return el instanceof HTMLElement ? el : null;
}

// getComputedStyle returns the custom property as resolved ("240px"); parse the
// leading number and fall back to the default if it isn't a px value.
function currentWidthPx(): number {
  const wrapper = sidebarWrapper();
  if (!wrapper) return DEFAULT_WIDTH;
  const raw = getComputedStyle(wrapper).getPropertyValue("--sidebar-width").trim();
  const px = Number.parseFloat(raw);
  return Number.isNaN(px) ? DEFAULT_WIDTH : px;
}

function setCssWidth(width: number): void {
  sidebarWrapper()?.style.setProperty("--sidebar-width", `${width}px`);
}

export function useResizableSidebar(): {
  handlePointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
} {
  const [storedWidth, setStoredWidth, loaded] = useDiskState<number>(
    STATE_KEY,
    DEFAULT_WIDTH,
    parseWidth,
  );
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  const resizingRef = useRef(false);

  // Apply the persisted width once ui-state has loaded (overrides the
  // provider's inline default). Re-applies after a drag too — a no-op, since
  // the CSS var already holds the same value.
  useEffect(() => {
    if (loaded) setCssWidth(storedWidth);
  }, [loaded, storedWidth]);

  // Pointer capture routes every move/up to the handle itself, so the drag
  // keeps tracking over iframes (vault apps) and outside the window.
  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      e.preventDefault();
      const handle = e.currentTarget;
      // NotFoundError if the pointer was already released (fast click) — the
      // drag still works for that gesture, just without capture.
      try {
        handle.setPointerCapture(e.pointerId);
      } catch {
        // no active pointer to capture
      }
      resizingRef.current = true;
      startXRef.current = e.clientX;
      startWidthRef.current = currentWidthPx();
      // Suppress the sidebar's width/row transitions + lock the cursor.
      document.documentElement.classList.add("sidebar-resizing");
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (ev: PointerEvent) => {
        if (!resizingRef.current) return;
        setCssWidth(clamp(startWidthRef.current + (ev.clientX - startXRef.current)));
      };
      const onUp = (ev: PointerEvent) => {
        if (!resizingRef.current) return;
        resizingRef.current = false;
        if (handle.hasPointerCapture(ev.pointerId)) handle.releasePointerCapture(ev.pointerId);
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        document.documentElement.classList.remove("sidebar-resizing");
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        setStoredWidth(currentWidthPx());
      };
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    },
    [setStoredWidth],
  );

  return { handlePointerDown };
}
