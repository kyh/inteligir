/**
 * Action dispatcher — routes a BrowserAction to the appropriate handler.
 *
 * Pure-ish module: all mutable state lives in the BrowserSession passed via
 * ActionContext, making this straightforward to test with a stub session.
 */

import type { WebContents } from "electron";
import type { BrowserAction } from "./schema";
import { text } from "./schema";
import type { ToolResult } from "./schema";
import type { BrowserSession } from "./browser-session";
import { cdpClick, cdpType, cdpPress, cdpHover } from "./cdp-adapter";
import { buildSnapshot } from "./snapshot-builder";

// Re-export for convenience — callers may need the type
export type { ToolResult };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default timeout for navigation operations (ms) */
const NAV_TIMEOUT_MS = 30_000;

/** Default timeout for evaluate action (ms) */
const EVALUATE_TIMEOUT_MS = 30_000;

/** Allowed URL schemes for the open action */
const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

// ---------------------------------------------------------------------------
// Navigation helper
// ---------------------------------------------------------------------------

/**
 * Wait for `did-finish-load` with a timeout fallback to prevent hanging
 * on network errors or redirect loops.
 *
 * Callers must register this listener BEFORE triggering navigation
 * (goBack, goForward, reload) so no events are missed.
 */
function awaitNavigation(contents: WebContents, timeoutMs = NAV_TIMEOUT_MS): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    function cleanup() {
      clearTimeout(timer);
      contents.removeListener("did-finish-load", onLoad);
      contents.removeListener("did-fail-load", onFail);
    }

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Navigation timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    function onLoad() {
      cleanup();
      resolve();
    }

    function onFail(_event: Electron.Event, errorCode: number, errorDescription: string) {
      // Aborted navigations (e.g. redirects) are not real failures — keep
      // listening for the final load or a real error.
      if (errorCode === -3) return;
      cleanup();
      reject(new Error(`Navigation failed: ${errorDescription} (code ${errorCode})`));
    }

    // Use `on` (not `once`) so redirect aborts (code -3) don't consume the
    // listener. cleanup() removes both listeners when we're done.
    contents.on("did-finish-load", onLoad);
    contents.on("did-fail-load", onFail);
  });
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface ActionContext {
  session: BrowserSession;
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export async function dispatchAction(
  action: BrowserAction,
  ctx: ActionContext,
): Promise<ToolResult> {
  const { session } = ctx;

  // Handle close without creating a window — avoids create-then-destroy.
  if (action.action === "close") {
    session.dispose();
    return text("Browser closed");
  }

  // Validate URL before creating a window so invalid URLs don't spin one up.
  if (action.action === "open") {
    if (!action.url) return text("Error: url is required for open action");
    try {
      const parsed = new URL(action.url);
      if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
        return text(`Error: URL scheme "${parsed.protocol}" is not allowed. Use http: or https: URLs only.`);
      }
    } catch {
      return text(`Error: Invalid URL "${action.url}"`);
    }
  }

  // Actions other than "open" require a page to already be loaded.
  // Avoid lazily creating a blank BrowserWindow for snapshot/get_url/etc.
  if (action.action !== "open" && !session.hasLoadedPage()) {
    return text('Error: No page loaded. Use the "open" action first to navigate to a URL.');
  }

  const contents = session.getContents();

  switch (action.action) {
    case "open": {
      const win = session.getWindow();
      // For the open action, loadURL already resolves once the page's main
      // frame finishes loading — a separate awaitNavigation listener would be
      // redundant and leak if loadURL rejects. (back/forward/reload still use
      // awaitNavigation since their APIs are fire-and-forget.)
      await contents.loadURL(action.url ?? "");
      if (!win.isVisible()) win.show();
      return text(`Navigated to ${action.url}`);
    }

    case "click": {
      if (!action.selector) return text("Error: selector is required for click");
      const sel = session.resolveSelector(action.selector);
      await cdpClick(contents, sel);
      return text(`Clicked ${action.selector}`);
    }

    case "fill": {
      if (!action.selector) return text("Error: selector is required for fill");
      if (action.text === undefined) return text("Error: text is required for fill");
      const sel = session.resolveSelector(action.selector);
      // Focus, clear, and type in a way that's resilient to React/Vue re-renders.
      // The JS call focuses and clears atomically before we insertText.
      const cleared = await contents.executeJavaScript(`
        (function() {
          const el = document.querySelector(${JSON.stringify(sel)});
          if (!el) return false;
          el.focus();
          // Use native setter to clear — works with React/Vue controlled inputs
          const proto = el.tagName === "INPUT" ? HTMLInputElement.prototype
            : el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype
            : null;
          const setter = proto && Object.getOwnPropertyDescriptor(proto, "value")?.set;
          if (setter) { setter.call(el, ""); }
          else if ("value" in el) { el.value = ""; }
          else { el.textContent = ""; } // contenteditable
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        })()
      `);
      if (!cleared) return text(`Error: Element not found: ${sel}`);
      await cdpType(contents, action.text);
      return text(`Filled ${action.selector} with "${action.text}"`);
    }

    case "type": {
      if (action.text === undefined) return text("Error: text is required for type");
      if (action.selector) {
        const sel = session.resolveSelector(action.selector);
        await cdpClick(contents, sel);
      }
      await cdpType(contents, action.text);
      return text(`Typed "${action.text}"`);
    }

    case "press": {
      if (!action.text) return text("Error: text (key name) is required for press");
      await cdpPress(contents, action.text);
      return text(`Pressed ${action.text}`);
    }

    case "hover": {
      if (!action.selector) return text("Error: selector is required for hover");
      const sel = session.resolveSelector(action.selector);
      await cdpHover(contents, sel);
      return text(`Hovered ${action.selector}`);
    }

    case "select": {
      if (!action.selector) return text("Error: selector is required for select");
      if (!action.text) return text("Error: text (option value) is required for select");
      const sel = session.resolveSelector(action.selector);
      const selectResult = await contents.executeJavaScript(`
        (function() {
          const el = document.querySelector(${JSON.stringify(sel)});
          if (!el) return "not_found";
          // Verify the option value exists before setting
          const optionExists = Array.from(el.options).some(o => o.value === ${JSON.stringify(action.text)});
          if (!optionExists) return "invalid_option";
          // Use the native value setter to bypass React/Vue overrides
          const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
          if (setter) setter.call(el, ${JSON.stringify(action.text)});
          else el.value = ${JSON.stringify(action.text)};
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return "ok";
        })()
      `) as string;
      if (selectResult === "not_found") return text(`Error: Element not found: ${sel}`);
      if (selectResult === "invalid_option") {
        return text(`Error: No <option> with value "${action.text}" found in ${action.selector}`);
      }
      return text(`Selected "${action.text}" in ${action.selector}`);
    }

    case "check": {
      if (!action.selector) return text("Error: selector is required for check");
      const sel = session.resolveSelector(action.selector);
      const desired = action.checked !== false; // default true
      const checkResult = await contents.executeJavaScript(`
        (function() {
          const el = document.querySelector(${JSON.stringify(sel)});
          if (!el) return "not_found";
          const want = ${desired};
          if (el.checked === want) return "already";
          // Use native prototype setter to bypass React/Vue property overrides
          // on controlled inputs (same pattern as fill).
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked")?.set;
          if (setter) setter.call(el, want);
          else el.checked = want;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return "toggled";
        })()
      `) as string;
      if (checkResult === "not_found") return text(`Error: Element not found: ${sel}`);
      if (checkResult === "already") return text(`Checkbox ${action.selector} already ${desired ? "checked" : "unchecked"}`);
      return text(`${desired ? "Checked" : "Unchecked"} ${action.selector}`);
    }

    case "snapshot": {
      const snapshot = await buildSnapshot(contents, session);
      return text(snapshot);
    }

    case "screenshot": {
      const win = session.getWindow();
      if (action.fullPage) {
        // Use CDP Page.captureScreenshot with captureBeyondViewport to capture
        // the full scrollable area without resizing the visible window.
        const MAX_WIDTH = 1280;
        const MAX_HEIGHT = 16384;
        const size = (await contents.executeJavaScript(`
          ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight })
        `)) as { width: number; height: number };
        const captureWidth = Math.min(size.width, MAX_WIDTH);
        const captureHeight = Math.min(size.height, MAX_HEIGHT);
        const devicePixelRatio = (await contents.executeJavaScript(
          "window.devicePixelRatio || 1",
        )) as number;
        const cdpResult = (await contents.debugger.sendCommand(
          "Page.captureScreenshot",
          {
            format: "png",
            captureBeyondViewport: true,
            clip: {
              x: 0,
              y: 0,
              width: captureWidth,
              height: captureHeight,
              scale: 1 / devicePixelRatio,
            },
          },
        )) as { data: string };
        return {
          content: [{ type: "image", data: cdpResult.data, mimeType: "image/png" }],
          details: {},
        };
      }
      const image = await win.webContents.capturePage();
      const base64 = image.toPNG().toString("base64");
      return {
        content: [{ type: "image", data: base64, mimeType: "image/png" }],
        details: {},
      };
    }

    case "get_text": {
      let result: string;
      if (action.selector) {
        const sel = session.resolveSelector(action.selector);
        result = (await contents.executeJavaScript(`
          document.querySelector(${JSON.stringify(sel)})?.textContent ?? "(element not found)"
        `)) as string;
      } else {
        result = (await contents.executeJavaScript(
          "document.body.innerText",
        )) as string;
      }
      return text(result);
    }

    case "get_url": {
      return text(contents.getURL());
    }

    case "get_title": {
      return text(contents.getTitle());
    }

    case "evaluate": {
      if (!action.script) return text("Error: script is required for evaluate");
      const timeout = action.timeout ?? EVALUATE_TIMEOUT_MS;
      // Note: on timeout the in-page script keeps running — there's no way to
      // cancel executeJavaScript. The abandoned promise may resolve/reject after
      // the browser is disposed; the .catch() below logs script errors that
      // arrived after the timeout so they aren't silently swallowed.
      const TIMEOUT_SENTINEL = Symbol("timeout");
      const scriptPromise = contents.executeJavaScript(action.script);
      const result = await Promise.race([
        scriptPromise,
        new Promise<typeof TIMEOUT_SENTINEL>((resolve) =>
          setTimeout(() => resolve(TIMEOUT_SENTINEL), timeout),
        ),
      ]);
      if (result === TIMEOUT_SENTINEL) {
        // Log late errors from the abandoned promise so they aren't silent
        scriptPromise.catch((err: unknown) => {
          console.warn("[browser-tool] evaluate script threw after timeout:", err);
        });
        return text(`Error: evaluate timed out after ${timeout}ms`);
      }
      const output = result === undefined ? "undefined"
        : typeof result === "string" ? result
        : JSON.stringify(result, null, 2);
      return text(output);
    }

    case "wait": {
      const ms = action.timeout ?? 5000;
      if (action.selector) {
        const sel = session.resolveSelector(action.selector);
        // The in-page promise has its own setTimeout, but if the renderer
        // hangs or crashes, executeJavaScript itself will never settle.
        // Wrap with a Node-side race so we don't hang indefinitely.
        const waitPromise = contents.executeJavaScript(`
          new Promise((resolve) => {
            const el = document.querySelector(${JSON.stringify(sel)});
            if (el) return resolve(true);
            const observer = new MutationObserver(() => {
              if (document.querySelector(${JSON.stringify(sel)})) {
                observer.disconnect();
                resolve(true);
              }
            });
            observer.observe(document.documentElement, { childList: true, subtree: true });
            setTimeout(() => { observer.disconnect(); resolve(false); }, ${ms});
          })
        `);
        const found = await Promise.race([
          waitPromise,
          new Promise<false>((resolve) => setTimeout(() => resolve(false), ms + 1000)),
        ]);
        // Suppress noise if the in-page promise settles after the Node-side timeout
        waitPromise.catch(() => {});
        return text(found ? `Found ${action.selector}` : `Timeout waiting for ${action.selector}`);
      }
      await new Promise((resolve) => setTimeout(resolve, ms));
      return text(`Waited ${ms}ms`);
    }

    case "scroll": {
      const dir = action.direction ?? "down";
      const amt = action.amount ?? 500;
      const delta = dir === "down" ? amt : -amt;
      await contents.executeJavaScript(`window.scrollBy(0, ${delta})`);
      return text(`Scrolled ${dir} ${amt}px`);
    }

    case "back": {
      if (!contents.canGoBack()) {
        return text("Already at the beginning of history");
      }
      const backNav = awaitNavigation(contents);
      contents.goBack();
      await backNav;
      return text("Navigated back");
    }

    case "forward": {
      if (!contents.canGoForward()) {
        return text("Already at the end of history");
      }
      const fwdNav = awaitNavigation(contents);
      contents.goForward();
      await fwdNav;
      return text("Navigated forward");
    }

    case "reload": {
      const navPromise = awaitNavigation(contents);
      contents.reload();
      await navPromise;
      return text("Reloaded page");
    }

    default:
      return text(`Unknown action: ${(action as BrowserAction).action}`);
  }
}
