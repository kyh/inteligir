/**
 * Browser automation tool — slim entry point.
 *
 * Registers the "browser" tool with pi-coding-agent and delegates all action
 * execution to the decomposed modules under ./browser/.
 *
 * Uses Chrome via CDP WebSocket — connects to the user's actual browser
 * with their sessions/cookies. No Electron dependency.
 */

import type { ExtensionAPI } from "@repo/pi-driver";
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
    description: `Drive a Chrome browser via CDP. Use for any task that needs web interaction: opening URLs, reading page content, filling forms, clicking buttons, screenshots, scraping. Workflow: open → snapshot (returns @e1, @e2... refs) → interact via refs → re-snapshot after any DOM change. Refs are invalidated by every navigation or SPA update. Each action's description in the parameter schema lists its required fields. Only http:// and https:// URLs are accepted.`,
    parameters: BrowserActionSchema,
    execute: async (_toolCallId, params) => {
      try {
        return await dispatchAction(params, { session: currentSession });
      } catch (err) {
        return text(`Browser error: ${err instanceof Error ? err.message : String(err)}`);
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
