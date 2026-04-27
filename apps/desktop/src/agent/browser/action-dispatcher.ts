/**
 * Action dispatcher — routes a BrowserAction to the appropriate handler.
 *
 * All browser interaction goes through CDP WebSocket to the user's Chrome.
 */

import type { CDPClient } from "./cdp-client";
import { evaluate } from "./cdp-client";
import type { BrowserAction } from "./schema";
import { text } from "./schema";
import type { ToolResult } from "./schema";
import type { BrowserSession } from "./browser-session";
import { cdpClick, cdpType, cdpPress, cdpHover } from "./cdp-adapter";
import { buildSnapshot } from "./snapshot-builder";

// Re-export for convenience
export type { ToolResult };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NAV_TIMEOUT_MS = 30_000;
const EVALUATE_TIMEOUT_MS = 30_000;
const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

// ---------------------------------------------------------------------------
// Navigation helper — wait for CDP Page.loadEventFired
// ---------------------------------------------------------------------------

function awaitNavigation(cdp: CDPClient, timeoutMs = NAV_TIMEOUT_MS): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cdp.off("Page.loadEventFired", onLoad);
      reject(new Error(`Navigation timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    function onLoad() {
      clearTimeout(timer);
      cdp.off("Page.loadEventFired", onLoad);
      resolve();
    }

    cdp.on("Page.loadEventFired", onLoad);
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

  // Handle close without connecting
  if (action.action === "close") {
    session.dispose();
    return text("Browser tab closed");
  }

  // Validate URL before connecting
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

  // Tab/network actions operate on session state only — they never need to
  // open a CDP connection of their own. Dispatching them straight through
  // also avoids an unconditional `ensureConnected()` creating a phantom tab
  // before, e.g., `tab_new` opens the user's actual first tab.
  switch (action.action) {
    case "tab_list": {
      const list = session.listTabs();
      if (list.length === 0) return text("(no open tabs)");
      const lines = list.map((t) => {
        const marker = t.current ? "*" : " ";
        const label = t.label ? ` [${t.label}]` : "";
        return `${marker} ${t.id}${label}\t${t.url || "about:blank"}`;
      });
      return text(lines.join("\n"));
    }
    case "tab_switch": {
      if (!action.tabId) return text("Error: tabId is required for tab_switch");
      try {
        const summary = session.switchTab(action.tabId);
        return text(`Switched to ${summary.id} (${summary.url || "about:blank"})`);
      } catch (err) {
        return text(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    case "tab_close": {
      const target = action.tabId ?? session.currentTabId();
      if (!target) return text("Error: no tab to close");
      await session.closeTab(target);
      return text(`Closed tab ${target}`);
    }
    case "network_log": {
      const log = session.getNetworkLog();
      const filter = action.filter?.toLowerCase();
      const filtered = filter ? log.filter((r) => r.url.toLowerCase().includes(filter)) : log;
      if (filtered.length === 0) return text("(no recent requests)");
      const lines = filtered.map((r) => {
        const status = r.status !== undefined ? String(r.status) : "...";
        return `${status}\t${r.method}\t${r.resourceType}\t${r.url}`;
      });
      return text(lines.join("\n"));
    }
    case "tab_new": {
      if (action.url) {
        try {
          const parsed = new URL(action.url);
          if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
            return text(`Error: URL scheme "${parsed.protocol}" is not allowed. Use http: or https: URLs only.`);
          }
        } catch {
          return text(`Error: Invalid URL "${action.url}"`);
        }
      }
      // Open a tab via the session — this creates the first CDP connection
      // when none exists, so we deliberately skip the dispatcher's
      // `ensureConnected()` to avoid spawning a second, phantom tab.
      const summary = await session.newTab({ label: action.label });
      if (action.url) {
        const newCdp = await session.ensureConnected();
        const navPromise = awaitNavigation(newCdp);
        await newCdp.send("Page.navigate", { url: action.url });
        await navPromise;
      }
      const label = summary.label ? ` [${summary.label}]` : "";
      return text(`Opened tab ${summary.id}${label}${action.url ? ` at ${action.url}` : ""}`);
    }
  }

  // tab_new validates its URL after dispatch, but the rest of the page-level
  // actions need an open tab and a loaded page (other than `open` itself).
  if (action.action !== "open" && !session.hasLoadedPage()) {
    return text('Error: No page loaded. Use the "open" action first to navigate to a URL.');
  }

  const cdp = await session.ensureConnected();

  switch (action.action) {
    case "open": {
      const navPromise = awaitNavigation(cdp);
      await cdp.send("Page.navigate", { url: action.url });
      await navPromise;
      return text(`Navigated to ${action.url}`);
    }

    case "click": {
      if (!action.selector) return text("Error: selector is required for click");
      const sel = session.resolveSelector(action.selector);
      await cdpClick(cdp, sel);
      return text(`Clicked ${action.selector}`);
    }

    case "fill": {
      if (!action.selector) return text("Error: selector is required for fill");
      if (action.text === undefined) return text("Error: text is required for fill");
      const sel = session.resolveSelector(action.selector);
      const cleared = await evaluate(cdp, `
        (function() {
          const el = document.querySelector(${JSON.stringify(sel)});
          if (!el) return false;
          el.focus();
          const proto = el.tagName === "INPUT" ? HTMLInputElement.prototype
            : el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype
            : null;
          const setter = proto && Object.getOwnPropertyDescriptor(proto, "value")?.set;
          if (setter) { setter.call(el, ""); }
          else if ("value" in el) { el.value = ""; }
          else { el.textContent = ""; }
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        })()
      `);
      if (!cleared) return text(`Error: Element not found: ${sel}`);
      await cdpType(cdp, action.text);
      return text(`Filled ${action.selector} with "${action.text}"`);
    }

    case "type": {
      if (action.text === undefined) return text("Error: text is required for type");
      if (action.selector) {
        const sel = session.resolveSelector(action.selector);
        await cdpClick(cdp, sel);
      }
      await cdpType(cdp, action.text);
      return text(`Typed "${action.text}"`);
    }

    case "press": {
      if (!action.text) return text("Error: text (key name) is required for press");
      await cdpPress(cdp, action.text);
      return text(`Pressed ${action.text}`);
    }

    case "hover": {
      if (!action.selector) return text("Error: selector is required for hover");
      const sel = session.resolveSelector(action.selector);
      await cdpHover(cdp, sel);
      return text(`Hovered ${action.selector}`);
    }

    case "select": {
      if (!action.selector) return text("Error: selector is required for select");
      if (!action.text) return text("Error: text (option value) is required for select");
      const sel = session.resolveSelector(action.selector);
      const selectResult = await evaluate(cdp, `
        (function() {
          const el = document.querySelector(${JSON.stringify(sel)});
          if (!el) return "not_found";
          const optionExists = Array.from(el.options).some(o => o.value === ${JSON.stringify(action.text)});
          if (!optionExists) return "invalid_option";
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
      const desired = action.checked !== false;
      const checkResult = await evaluate(cdp, `
        (function() {
          const el = document.querySelector(${JSON.stringify(sel)});
          if (!el) return "not_found";
          const want = ${desired};
          if (el.checked === want) return "already";
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
      const snapshot = await buildSnapshot(cdp, session);
      return text(snapshot);
    }

    case "screenshot": {
      if (action.fullPage) {
        const MAX_WIDTH = 1280;
        const MAX_HEIGHT = 16384;
        const size = (await evaluate(cdp, `
          ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight })
        `)) as { width: number; height: number };
        const captureWidth = Math.min(size.width, MAX_WIDTH);
        const captureHeight = Math.min(size.height, MAX_HEIGHT);
        const devicePixelRatio = (await evaluate(cdp, "window.devicePixelRatio || 1")) as number;
        const cdpResult = await cdp.send("Page.captureScreenshot", {
          format: "png",
          captureBeyondViewport: true,
          clip: {
            x: 0,
            y: 0,
            width: captureWidth,
            height: captureHeight,
            scale: 1 / devicePixelRatio,
          },
        });
        return {
          content: [{ type: "image", data: cdpResult["data"] as string, mimeType: "image/png" }],
          details: {},
        };
      }
      // Viewport screenshot — same CDP command without clip
      const cdpResult = await cdp.send("Page.captureScreenshot", { format: "png" });
      return {
        content: [{ type: "image", data: cdpResult["data"] as string, mimeType: "image/png" }],
        details: {},
      };
    }

    case "cookies_get": {
      const result = await cdp.send("Network.getCookies");
      const cookies = (result["cookies"] as Array<Record<string, unknown>>) ?? [];
      const lines = cookies.map((c) =>
        `${String(c["name"])}=${String(c["value"])}\tdomain=${String(c["domain"])}\tpath=${String(c["path"])}`,
      );
      return text(lines.length === 0 ? "(no cookies)" : lines.join("\n"));
    }

    case "cookies_set": {
      if (!action.name) return text("Error: name is required for cookies_set");
      if (action.value === undefined) return text("Error: value is required for cookies_set");
      const url = (await evaluate(cdp, "location.href")) as string;
      const params: Record<string, unknown> = {
        name: action.name,
        value: action.value,
        url,
      };
      if (action.domain) params["domain"] = action.domain;
      const ok = await cdp.send("Network.setCookie", params);
      if (ok["success"] === false) return text(`Error: failed to set cookie ${action.name}`);
      return text(`Set cookie ${action.name}`);
    }

    case "cookies_clear": {
      await cdp.send("Network.clearBrowserCookies");
      return text("Cleared all cookies");
    }

    case "storage_get": {
      if (action.name) {
        const value = (await evaluate(cdp, `localStorage.getItem(${JSON.stringify(action.name)})`)) as string | null;
        return text(value === null ? `(${action.name} not set)` : value);
      }
      const all = (await evaluate(cdp, `
        (function() {
          const out = {};
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k !== null) out[k] = localStorage.getItem(k);
          }
          return out;
        })()
      `)) as Record<string, string>;
      const keys = Object.keys(all);
      if (keys.length === 0) return text("(localStorage is empty)");
      return text(keys.map((k) => `${k}=${all[k]}`).join("\n"));
    }

    case "storage_set": {
      if (!action.name) return text("Error: name is required for storage_set");
      if (action.value === undefined) return text("Error: value is required for storage_set");
      await evaluate(cdp, `localStorage.setItem(${JSON.stringify(action.name)}, ${JSON.stringify(action.value)})`);
      return text(`Set localStorage ${action.name}`);
    }

    case "storage_clear": {
      await evaluate(cdp, "localStorage.clear()");
      return text("Cleared localStorage");
    }

    case "get_text": {
      let result: string;
      if (action.selector) {
        const sel = session.resolveSelector(action.selector);
        result = (await evaluate(cdp, `
          document.querySelector(${JSON.stringify(sel)})?.textContent ?? "(element not found)"
        `)) as string;
      } else {
        result = (await evaluate(cdp, "document.body.innerText")) as string;
      }
      return text(result);
    }

    case "get_url": {
      const url = (await evaluate(cdp, "location.href")) as string;
      return text(url);
    }

    case "get_title": {
      const title = (await evaluate(cdp, "document.title")) as string;
      return text(title);
    }

    case "evaluate": {
      if (!action.script) return text("Error: script is required for evaluate");
      const timeout = action.timeout ?? EVALUATE_TIMEOUT_MS;
      const TIMEOUT_SENTINEL = Symbol("timeout");
      const scriptPromise = evaluate(cdp, action.script);
      const result = await Promise.race([
        scriptPromise,
        new Promise<typeof TIMEOUT_SENTINEL>((resolve) =>
          setTimeout(() => resolve(TIMEOUT_SENTINEL), timeout),
        ),
      ]);
      if (result === TIMEOUT_SENTINEL) {
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
        const waitPromise = evaluate(cdp, `
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
      await evaluate(cdp, `window.scrollBy(0, ${delta})`);
      return text(`Scrolled ${dir} ${amt}px`);
    }

    case "back": {
      const history = await cdp.send("Page.getNavigationHistory");
      const currentIndex = history["currentIndex"] as number;
      if (currentIndex <= 0) return text("Already at the beginning of history");
      const navPromise = awaitNavigation(cdp);
      await evaluate(cdp, "history.back()");
      await navPromise;
      return text("Navigated back");
    }

    case "forward": {
      const history = await cdp.send("Page.getNavigationHistory");
      const currentIndex = history["currentIndex"] as number;
      const entries = history["entries"] as unknown[];
      if (currentIndex >= entries.length - 1) return text("Already at the end of history");
      const navPromise = awaitNavigation(cdp);
      await evaluate(cdp, "history.forward()");
      await navPromise;
      return text("Navigated forward");
    }

    case "reload": {
      const navPromise = awaitNavigation(cdp);
      await cdp.send("Page.reload");
      await navPromise;
      return text("Reloaded page");
    }

    default:
      return text(`Unknown action: ${(action as BrowserAction).action}`);
  }
}
