/**
 * Browser automation tool — slim entry point.
 *
 * Registers the "browser" tool with pi-coding-agent and delegates all action
 * execution to the decomposed modules under ./browser/.
 *
 * Uses Chrome via CDP WebSocket — connects to the user's actual browser
 * with their sessions/cookies. No Electron dependency.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { BrowserActionSchema } from "./browser/schema";
import { text } from "./browser/schema";
import { createBrowserSession, type BrowserSession } from "./browser/browser-session";
import { dispatchAction } from "./browser/action-dispatcher";

// Re-export types that external code may depend on
export type { BrowserAction } from "./browser/schema";

let session: BrowserSession | null = null;

/**
 * Register the browser automation tool with pi-coding-agent.
 * Call once per process — the tool uses a module-level singleton session.
 */
export function registerBrowserExtension(pi: ExtensionAPI): void {
  session = createBrowserSession();

  const currentSession = session;

  pi.registerTool({
    name: "browser",
    label: "browser",
    description: `Browse the web using Chrome via CDP. Launches a dedicated Chrome instance, or connects to an existing one on port 9222.

Core workflow — every browser task follows this pattern:
1. open: Navigate to a URL (opens a new Chrome tab)
2. snapshot: Get the accessibility tree with element refs (@e1, @e2, ...)
3. Interact: Use refs to click, fill, type, select, check, hover
4. Re-snapshot: After navigation or DOM changes, ALWAYS get fresh refs

IMPORTANT: Refs (@e1, @e2) are INVALIDATED after any page change. Always re-snapshot after:
- Clicking links or buttons that navigate
- Form submissions
- Dynamic content loading (dropdowns, modals, SPAs)

Actions:
- Navigation/input: open, click, fill, type, press, hover, select, check, scroll, back, forward, reload, wait, close
- Inspection: snapshot, screenshot, get_text, get_url, get_title, evaluate
- Cookies/storage: cookies_get, cookies_set, cookies_clear, storage_get, storage_set, storage_clear
- Network: network_log (recent requests, optionally filtered by URL substring)
- Tabs: tab_list, tab_new, tab_switch, tab_close`,
    parameters: BrowserActionSchema,
    execute: async (_toolCallId, params) => {
      try {
        return await dispatchAction(params, { session: currentSession });
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
  session?.dispose();
  session = null;
}
