/**
 * Browser automation tool — slim entry point.
 *
 * Registers the "browser" tool with pi-coding-agent and delegates all action
 * execution to the decomposed modules under ./browser/.
 *
 * Concurrency: session is a module-level singleton. Tool calls must be
 * serialized — pi-coding-agent handles this.
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
    description:
      "Browse the web, interact with pages, take screenshots, and extract data. " +
      "Uses a built-in browser — no external tools required. " +
      "Workflow: open a URL → snapshot to see elements → interact using @refs → extract or screenshot.",
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
