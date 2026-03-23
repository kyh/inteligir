/**
 * Browser automation tool using Electron's native webContents + CDP debugger.
 * No external dependencies — uses the Chromium already bundled with Electron.
 *
 * Registered as a pi-coding-agent extension so the agent can browse the web,
 * scrape pages, fill forms, take screenshots, etc.
 *
 * Concurrency: browserWindow and refSelectors are module-level singletons.
 * Tool calls must be serialized — concurrent calls (e.g. snapshot + fill)
 * could clear the ref map mid-flight. This is safe in practice because
 * pi-coding-agent serializes tool execution.
 */

import { BrowserWindow } from "electron";
import type { WebContents } from "electron";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type, type Static } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default timeout for navigation operations (ms) */
const NAV_TIMEOUT_MS = 30_000;

/** Max characters for snapshot output to avoid blowing up the agent's context */
const SNAPSHOT_MAX_CHARS = 30_000;

/** Max DOM depth and node count to cap snapshot computation time */
const SNAPSHOT_MAX_DEPTH = 40;
const SNAPSHOT_MAX_NODES = 10_000;

/** Allowed URL schemes for the open action */
const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

// ---------------------------------------------------------------------------
// Browser lifecycle — lazily create a BrowserWindow (shown on open)
// ---------------------------------------------------------------------------

let browserWindow: BrowserWindow | null = null;

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

  // Attach CDP debugger for input simulation (click, type, etc.)
  browserWindow.webContents.debugger.attach("1.3");

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

function disposeBrowser(): void {
  const win = browserWindow;
  // Null out first to guard against re-entrancy — close() can fire the
  // "closed" event synchronously in some Electron versions.
  browserWindow = null;
  refSelectors.clear();
  if (win && !win.isDestroyed()) {
    try {
      win.webContents.debugger.detach();
    } catch { /* already detached */ }
    win.close();
  }
}

// ---------------------------------------------------------------------------
// Navigation helpers
// ---------------------------------------------------------------------------

/**
 * Wait for `did-finish-load` with a timeout fallback to prevent hanging
 * on network errors or redirect loops.
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
// Result helpers — must match pi-ai's TextContent / ImageContent interfaces
// ---------------------------------------------------------------------------

type ToolResult = {
  content: (
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  )[];
  details: Record<string, unknown>;
};

function text(s: string): ToolResult {
  return { content: [{ type: "text", text: s }], details: {} };
}

// ---------------------------------------------------------------------------
// CDP helpers for input simulation
// ---------------------------------------------------------------------------

/**
 * Get the bounding box of an element via CDP DOM queries.
 * Returns center coordinates for click/hover targets.
 */
async function getElementCenter(
  contents: WebContents,
  selector: string,
): Promise<{ x: number; y: number }> {
  const rect = await contents.executeJavaScript(`
    (function() {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()
  `);
  if (!rect) throw new Error(`Element not found: ${selector}`);
  return rect as { x: number; y: number };
}

async function cdpClick(contents: WebContents, selector: string): Promise<void> {
  const { x, y } = await getElementCenter(contents, selector);
  const debugger_ = contents.debugger;
  for (const type of ["mousePressed", "mouseReleased"] as const) {
    await debugger_.sendCommand("Input.dispatchMouseEvent", {
      type,
      x,
      y,
      button: "left",
      clickCount: 1,
    });
  }
}

async function cdpType(contents: WebContents, value: string): Promise<void> {
  // Input.insertText sends the entire string in a single CDP round-trip,
  // which is dramatically faster than dispatching keyDown/keyUp per character.
  await contents.debugger.sendCommand("Input.insertText", { text: value });
}

async function cdpPress(contents: WebContents, key: string): Promise<void> {
  // Map common key names to CDP key identifiers
  const keyMap: Record<string, { key: string; code: string; keyCode?: number }> = {
    Enter: { key: "Enter", code: "Enter", keyCode: 13 },
    Tab: { key: "Tab", code: "Tab", keyCode: 9 },
    Escape: { key: "Escape", code: "Escape", keyCode: 27 },
    Backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
    Delete: { key: "Delete", code: "Delete", keyCode: 46 },
    ArrowDown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
    ArrowUp: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
    ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
    ArrowRight: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
    Space: { key: " ", code: "Space", keyCode: 32 },
  };

  const mapped = keyMap[key] ?? { key, code: `Key${key.toUpperCase()}` };
  const debugger_ = contents.debugger;

  await debugger_.sendCommand("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: mapped.key,
    code: mapped.code,
    windowsVirtualKeyCode: mapped.keyCode,
  });
  await debugger_.sendCommand("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: mapped.key,
    code: mapped.code,
    windowsVirtualKeyCode: mapped.keyCode,
  });
}

async function cdpHover(contents: WebContents, selector: string): Promise<void> {
  const { x, y } = await getElementCenter(contents, selector);
  await contents.debugger.sendCommand("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x,
    y,
  });
}

// ---------------------------------------------------------------------------
// Accessibility snapshot
// ---------------------------------------------------------------------------

async function buildSnapshot(contents: WebContents): Promise<string> {
  const result = await contents.executeJavaScript(`
    (function() {
      const interactiveRoles = new Set([
        "link", "button", "textbox", "checkbox", "radio", "combobox",
        "menuitem", "tab", "switch", "searchbox", "slider", "spinbutton",
      ]);

      const roleMap = { a: "link", button: "button", input: "textbox",
        textarea: "textbox", select: "combobox" };

      const MAX_DEPTH = ${SNAPSHOT_MAX_DEPTH};
      const MAX_NODES = ${SNAPSHOT_MAX_NODES};
      let refCounter = 0;
      let nodeCount = 0;
      const refs = [];

      function getRole(el) {
        return el.getAttribute("role") || roleMap[el.tagName.toLowerCase()] || null;
      }

      function escapeAttrValue(s) {
        return s.replace(/\\\\/g, "\\\\\\\\").replace(/"/g, '\\\\"');
      }

      function walk(el, depth) {
        if (!el || el.nodeType !== 1) return "";
        if (depth > MAX_DEPTH || nodeCount >= MAX_NODES) return "";
        nodeCount++;
        const role = getRole(el) || el.tagName.toLowerCase();
        const name = el.getAttribute("aria-label") || el.getAttribute("alt")
          || el.getAttribute("title") || el.getAttribute("placeholder") || "";
        const value = el.value !== undefined && el.value !== "" ? el.value : "";

        let refLabel = "";
        const isInteractive = interactiveRoles.has(role) ||
          (el.tagName === "A" && el.href) ||
          el.tagName === "BUTTON" ||
          (el.tagName === "INPUT" && el.type !== "hidden") ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT";

        if (isInteractive) {
          refCounter++;
          refLabel = " @e" + refCounter;

          // Build a selector for this element
          let selector;
          if (el.id) {
            selector = "#" + CSS.escape(el.id);
          } else if (el.getAttribute("aria-label")) {
            const r = el.getAttribute("role") || el.tagName.toLowerCase();
            selector = r + '[aria-label="' + escapeAttrValue(el.getAttribute("aria-label")) + '"]';
          } else {
            // nth-of-type chain
            const parts = [];
            let cur = el;
            while (cur && cur !== document.body) {
              const parent = cur.parentElement;
              if (!parent) break;
              const tag = cur.tagName;
              const siblings = Array.from(parent.children).filter(c => c.tagName === tag);
              const idx = siblings.indexOf(cur) + 1;
              const t = tag.toLowerCase();
              parts.unshift(siblings.length > 1 ? t + ":nth-of-type(" + idx + ")" : t);
              cur = parent;
            }
            selector = parts.join(" > ");
          }
          refs.push({ ref: "@e" + refCounter, selector: selector });
        }

        const indent = "  ".repeat(depth);
        let line = indent + "[" + role + "]" + refLabel;
        const label = name || (el.textContent || "").trim().slice(0, 60);
        if (label) line += ' "' + label.replace(/"/g, '\\\\"') + '"';
        if (value) line += ' value="' + value.replace(/"/g, '\\\\"') + '"';

        const lines = [line];
        for (const child of el.children) {
          const childResult = walk(child, depth + 1);
          if (childResult) lines.push(childResult);
        }
        return lines.join("\\n");
      }

      const tree = walk(document.body, 0);
      return JSON.stringify({ tree: tree, refs: refs });
    })()
  `);

  const parsed = JSON.parse(result as string) as {
    tree: string;
    refs: { ref: string; selector: string }[];
  };

  // Update the ref map
  refSelectors.clear();
  for (const { ref, selector } of parsed.refs) {
    refSelectors.set(ref, selector);
  }

  const tree = parsed.tree;
  if (tree.length > SNAPSHOT_MAX_CHARS) {
    const truncated = tree.slice(0, SNAPSHOT_MAX_CHARS);
    return `${truncated}\n\n(truncated — showing first ${SNAPSHOT_MAX_CHARS} chars, but all ${parsed.refs.length} element refs are usable)`;
  }
  return tree;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const BrowserActionSchema = Type.Object({
  action: Type.Union(
    [
      Type.Literal("open"),
      Type.Literal("click"),
      Type.Literal("fill"),
      Type.Literal("type"),
      Type.Literal("press"),
      Type.Literal("hover"),
      Type.Literal("select"),
      Type.Literal("snapshot"),
      Type.Literal("screenshot"),
      Type.Literal("get_text"),
      Type.Literal("get_url"),
      Type.Literal("get_title"),
      Type.Literal("evaluate"),
      Type.Literal("wait"),
      Type.Literal("check"),
      Type.Literal("scroll"),
      Type.Literal("back"),
      Type.Literal("forward"),
      Type.Literal("reload"),
      Type.Literal("close"),
    ],
    { description: "Browser action to perform" },
  ),
  url: Type.Optional(Type.String({ description: "URL (for open action)" })),
  selector: Type.Optional(
    Type.String({
      description:
        "CSS selector or @ref from snapshot (e.g. @e1). Used for click, fill, type, hover, select, get_text, wait.",
    }),
  ),
  text: Type.Optional(
    Type.String({
      description: "Text value (for fill, type actions) or key name (for press)",
    }),
  ),
  script: Type.Optional(
    Type.String({ description: "JavaScript to evaluate (for evaluate action)" }),
  ),
  direction: Type.Optional(
    Type.Union([Type.Literal("up"), Type.Literal("down")], {
      description: "Scroll direction (default: down)",
    }),
  ),
  amount: Type.Optional(
    Type.Number({ description: "Scroll amount in pixels (default: 500)" }),
  ),
  fullPage: Type.Optional(
    Type.Boolean({ description: "Full page screenshot (default: false)" }),
  ),
  timeout: Type.Optional(
    Type.Number({ description: "Timeout in ms for wait action (default: 5000)" }),
  ),
  checked: Type.Optional(
    Type.Boolean({ description: "Desired checked state for check action (default: true)" }),
  ),
});

type BrowserAction = Static<typeof BrowserActionSchema>;

// ---------------------------------------------------------------------------
// Ref resolution — maps @eN refs from snapshots to CSS selectors
// ---------------------------------------------------------------------------

const refSelectors = new Map<string, string>();

function resolveSelector(selector: string): string {
  if (!selector.startsWith("@e")) return selector;

  const resolved = refSelectors.get(selector);
  if (resolved) return resolved;

  throw new Error(
    `Unknown ref "${selector}". Run the "snapshot" action first to get element refs.`,
  );
}

// ---------------------------------------------------------------------------
// Action execution
// ---------------------------------------------------------------------------

async function executeBrowserAction(action: BrowserAction): Promise<ToolResult> {
  // Handle close without creating a window — avoids create-then-destroy.
  if (action.action === "close") {
    disposeBrowser();
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
  if (action.action !== "open" && !hasLoadedPage()) {
    return text('Error: No page loaded. Use the "open" action first to navigate to a URL.');
  }

  const contents = getContents();

  switch (action.action) {
    case "open": {
      const win = getWindow();
      // For the open action, loadURL already resolves once the page's main
      // frame finishes loading — a separate awaitNavigation listener would be
      // redundant and leak if loadURL rejects. (back/forward/reload still use
      // awaitNavigation since their APIs are fire-and-forget.)
      await contents.loadURL(action.url!);
      if (!win.isVisible()) win.show();
      return text(`Navigated to ${action.url}`);
    }

    case "click": {
      if (!action.selector) return text("Error: selector is required for click");
      const sel = resolveSelector(action.selector);
      await cdpClick(contents, sel);
      return text(`Clicked ${action.selector}`);
    }

    case "fill": {
      if (!action.selector) return text("Error: selector is required for fill");
      if (action.text === undefined) return text("Error: text is required for fill");
      const sel = resolveSelector(action.selector);
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
      if (!action.text) return text("Error: text is required for type");
      if (action.selector) {
        const sel = resolveSelector(action.selector);
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
      const sel = resolveSelector(action.selector);
      await cdpHover(contents, sel);
      return text(`Hovered ${action.selector}`);
    }

    case "select": {
      if (!action.selector) return text("Error: selector is required for select");
      if (!action.text) return text("Error: text (option value) is required for select");
      const sel = resolveSelector(action.selector);
      const found = await contents.executeJavaScript(`
        (function() {
          const el = document.querySelector(${JSON.stringify(sel)});
          if (!el) return false;
          // Use the native value setter to bypass React/Vue overrides
          const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype
            : el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
          if (setter) setter.call(el, ${JSON.stringify(action.text)});
          else el.value = ${JSON.stringify(action.text)};
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        })()
      `);
      if (!found) return text(`Error: Element not found: ${sel}`);
      return text(`Selected "${action.text}" in ${action.selector}`);
    }

    case "check": {
      if (!action.selector) return text("Error: selector is required for check");
      const sel = resolveSelector(action.selector);
      const desired = action.checked !== false; // default true
      const result = await contents.executeJavaScript(`
        (function() {
          const el = document.querySelector(${JSON.stringify(sel)});
          if (!el) return "not_found";
          const want = ${desired};
          if (el.checked === want) return "already";
          el.focus();
          el.click();
          return el.checked === want ? "toggled" : "failed";
        })()
      `) as string;
      if (result === "not_found") return text(`Error: Element not found: ${sel}`);
      if (result === "already") return text(`Checkbox ${action.selector} already ${desired ? "checked" : "unchecked"}`);
      return text(`${desired ? "Checked" : "Unchecked"} ${action.selector}`);
    }

    case "snapshot": {
      const snapshot = await buildSnapshot(contents);
      return text(snapshot);
    }

    case "screenshot": {
      const win = getWindow();
      let image: Electron.NativeImage;
      if (action.fullPage) {
        // Temporarily resize to the full scrollable area, capture, then restore.
        // Cap dimensions to avoid enormous images from pathological pages.
        const MAX_WIDTH = 1280;
        const MAX_HEIGHT = 16384;
        const size = (await contents.executeJavaScript(`
          ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight })
        `)) as { width: number; height: number };
        const captureWidth = Math.min(size.width, MAX_WIDTH);
        const captureHeight = Math.min(size.height, MAX_HEIGHT);
        const original = win.getContentSize();
        win.setContentSize(captureWidth, captureHeight);
        // Wait for resize + a short settle for HiDPI repaints
        await new Promise<void>((resolve) => {
          function onResize() {
            clearTimeout(fallback);
            setTimeout(resolve, 50);
          }
          const fallback = setTimeout(() => {
            win.removeListener("resize", onResize);
            resolve();
          }, 500);
          win.once("resize", onResize);
        });
        try {
          image = await contents.capturePage();
        } finally {
          win.setContentSize(original[0], original[1]);
        }
      } else {
        image = await contents.capturePage();
      }
      const base64 = image.toPNG().toString("base64");
      return {
        content: [{ type: "image", data: base64, mimeType: "image/png" }],
        details: {},
      };
    }

    case "get_text": {
      let result: string;
      if (action.selector) {
        const sel = resolveSelector(action.selector);
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
      const result = await contents.executeJavaScript(action.script);
      return text(
        typeof result === "string" ? result : JSON.stringify(result, null, 2),
      );
    }

    case "wait": {
      const ms = action.timeout ?? 5000;
      if (action.selector) {
        const sel = resolveSelector(action.selector);
        // Note: if the browser is disposed or navigates while waiting, the
        // in-page observer/timeout will naturally expire with the page context.
        const found = await contents.executeJavaScript(`
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function registerBrowserExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "browser",
    label: "browser",
    description:
      "Browse the web, interact with pages, take screenshots, and extract data. " +
      "Uses a built-in browser — no external tools required. " +
      "Workflow: open a URL → snapshot to see elements → interact using @refs → extract or screenshot.",
    parameters: BrowserActionSchema,
    execute: async (_toolCallId, params) => {
      try {
        return await executeBrowserAction(params);
      } catch (err) {
        return text(
          `Browser error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  });
}

/**
 * Clean up browser resources. Call during app shutdown.
 */
export function disposeBrowserTool(): void {
  disposeBrowser();
}
