/**
 * Browser session — CDP WebSocket connection to a Chrome tab.
 *
 * Connects to the user's Chrome browser via CDP. Opens a new tab for the agent
 * and manages the ref (@eN → CSS selector) mapping.
 */

import {
  CDPClient,
  closeTab,
  discoverChromeEndpoint,
  openNewTab,
} from "./cdp-client";

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface BrowserSession {
  /** Get the CDP client. Lazily connects to Chrome and opens a tab. */
  ensureConnected(): Promise<CDPClient>;
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
  let cdp: CDPClient | null = null;
  let connectPromise: Promise<CDPClient> | null = null;
  let httpEndpoint: string | null = null;
  let targetId: string | null = null;
  let currentUrl = "";
  const refSelectors = new Map<string, string>();
  let disposed = false;

  async function connect(): Promise<CDPClient> {
    httpEndpoint = await discoverChromeEndpoint();
    const tab = await openNewTab(httpEndpoint);
    targetId = tab.id;

    const client = await CDPClient.connect(tab.webSocketDebuggerUrl);

    // Enable required CDP domains
    await client.send("Page.enable");
    await client.send("Runtime.enable");

    // Track navigation to invalidate refs
    client.on("Page.frameNavigated", (params) => {
      const frame = params["frame"] as Record<string, unknown> | undefined;
      // Only clear for main frame navigations
      if (!frame || !frame["parentId"]) {
        currentUrl = (frame?.["url"] as string) ?? "";
        refSelectors.clear();
      }
    });

    // SPA navigations (pushState/replaceState/hash)
    client.on("Page.navigatedWithinDocument", () => {
      refSelectors.clear();
    });

    cdp = client;
    return client;
  }

  function ensureConnected(): Promise<CDPClient> {
    if (cdp) return Promise.resolve(cdp);
    if (connectPromise) return connectPromise;
    connectPromise = connect().finally(() => { connectPromise = null; });
    return connectPromise;
  }

  function hasLoadedPage(): boolean {
    return currentUrl !== "" && currentUrl !== "about:blank";
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
    disposed = true;
    refSelectors.clear();

    if (cdp) {
      cdp.close();
      cdp = null;
    }

    // Close the tab we opened
    if (httpEndpoint && targetId) {
      closeTab(httpEndpoint, targetId).catch(() => {});
      targetId = null;
    }

    currentUrl = "";
  }

  return {
    ensureConnected,
    hasLoadedPage,
    updateRefs,
    resolveSelector,
    dispose,
    get isDisposed() {
      return disposed;
    },
  };
}
