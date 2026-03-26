/**
 * BrowserWindow lifecycle + ref map.
 *
 * Manages a single Electron BrowserWindow instance, the CDP debugger attachment,
 * and the mapping from snapshot @eN refs to CSS selectors.
 */

import { BrowserWindow } from "electron";
import type { WebContents } from "electron";

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface BrowserSession {
  getWindow(): BrowserWindow;
  getContents(): WebContents;
  hasLoadedPage(): boolean;
  updateRefs(refs: ReadonlyArray<{ ref: string; selector: string }>): void;
  resolveSelector(selector: string): string;
  dispose(): void;
  readonly isDisposed: boolean;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function createBrowserSession(): BrowserSession {
  let browserWindow: BrowserWindow | null = null;
  const refSelectors = new Map<string, string>();
  let disposed = false;

  function getWindow(): BrowserWindow {
    if (browserWindow && !browserWindow.isDestroyed()) return browserWindow;

    browserWindow = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    // Attach CDP debugger for input simulation (click, type, etc.).
    // Protocol version "1.3" is pinned for stability — Electron bundles a
    // specific Chromium, so there's no benefit to requesting a newer version,
    // and bumping could break if the bundled Chromium doesn't support it.
    try {
      browserWindow.webContents.debugger.attach("1.3");
    } catch {
      // Already attached (e.g. DevTools open) — safe to continue
    }

    // Clear stale refs on navigation (refs are page-specific).
    // did-navigate fires on full navigations; did-navigate-in-page fires on
    // SPA pushState/replaceState/hash changes (React Router, Next.js, etc.).
    browserWindow.webContents.on("did-navigate", () => {
      refSelectors.clear();
    });
    browserWindow.webContents.on("did-navigate-in-page", () => {
      refSelectors.clear();
    });

    // Clear stale refs if the window is destroyed externally (crash, user close)
    browserWindow.on("closed", () => {
      refSelectors.clear();
      browserWindow = null;
    });

    return browserWindow;
  }

  function getContents(): WebContents {
    return getWindow().webContents;
  }

  /** True if the browser has navigated to a real page (not blank). */
  function hasLoadedPage(): boolean {
    if (!browserWindow || browserWindow.isDestroyed()) return false;
    const url = browserWindow.webContents.getURL();
    return url !== "" && url !== "about:blank";
  }

  function updateRefs(refs: ReadonlyArray<{ ref: string; selector: string }>): void {
    refSelectors.clear();
    for (const { ref, selector } of refs) {
      refSelectors.set(ref, selector);
    }
  }

  function resolveSelector(selector: string): string {
    if (!selector.startsWith("@e")) return selector;

    const resolved = refSelectors.get(selector);
    if (resolved) return resolved;

    throw new Error(
      `Unknown ref "${selector}". Run the "snapshot" action first to get element refs.`,
    );
  }

  function dispose(): void {
    const win = browserWindow;
    // Null out first to guard against re-entrancy — close() can fire the
    // "closed" event synchronously in some Electron versions.
    browserWindow = null;
    disposed = true;
    refSelectors.clear();
    if (win && !win.isDestroyed()) {
      try {
        win.webContents.debugger.detach();
      } catch { /* already detached */ }
      win.close();
    }
  }

  return {
    getWindow,
    getContents,
    hasLoadedPage,
    updateRefs,
    resolveSelector,
    dispose,
    get isDisposed() {
      return disposed;
    },
  };
}
