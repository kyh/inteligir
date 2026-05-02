/**
 * Browser session — CDP WebSocket connections to one or more Chrome tabs.
 *
 * Manages a set of agent-owned tabs identified by stable ids (t1, t2, ...).
 * One tab is "current" at any time; existing actions operate on it. Tab
 * management actions (tab_new, tab_switch, ...) manipulate the set.
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

export interface TabSummary {
  id: string;
  label?: string;
  url: string;
  current: boolean;
}

export interface BrowserSession {
  /** Get the CDP client for the current tab. Lazily connects and opens a tab. */
  ensureConnected(): Promise<CDPClient>;
  hasLoadedPage(): boolean;
  updateRefs(refs: ReadonlyArray<{ ref: string; selector: string }>): void;
  resolveSelector(selector: string): string;

  // Multi-tab API
  listTabs(): TabSummary[];
  newTab(opts?: { label?: string }): Promise<TabSummary>;
  switchTab(tabId: string): TabSummary;
  closeTab(tabId?: string): Promise<void>;
  currentTabId(): string | null;

  dispose(): void;
  readonly isDisposed: boolean;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

interface TabState {
  id: string;
  label?: string;
  targetId: string;
  cdp: CDPClient;
  currentUrl: string;
}

export function createBrowserSession(): BrowserSession {
  const tabs = new Map<string, TabState>();
  let currentId: string | null = null;
  let nextTabNumber = 1;
  let connectPromise: Promise<TabState> | null = null;
  let httpEndpoint: string | null = null;
  let disposed = false;
  // Refs live at the session level — they describe the most recent snapshot's
  // interactive elements, are cleared on any navigation, and are usable even
  // before a tab has been opened (the dispatcher may invoke `updateRefs`/
  // `resolveSelector` independently of CDP for tests and tooling).
  const refSelectors = new Map<string, string>();

  function requireTab(tabId?: string | null): TabState {
    const id = tabId ?? currentId;
    if (!id) throw new Error("No browser tab is open");
    const tab = tabs.get(id);
    if (!tab) throw new Error(`Unknown tab id: ${id}`);
    return tab;
  }

  async function attachTab(targetId: string, wsUrl: string, label?: string): Promise<TabState> {
    const id = `t${nextTabNumber++}`;
    const cdp = await CDPClient.connect(wsUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");

    const state: TabState = {
      id,
      label,
      targetId,
      cdp,
      currentUrl: "",
    };

    cdp.on("Page.frameNavigated", (params) => {
      const frame = params["frame"] as Record<string, unknown> | undefined;
      if (!frame || !frame["parentId"]) {
        state.currentUrl = (frame?.["url"] as string) ?? "";
        if (state.id === currentId) refSelectors.clear();
      }
    });

    cdp.on("Page.navigatedWithinDocument", () => {
      if (state.id === currentId) refSelectors.clear();
    });

    tabs.set(id, state);
    return state;
  }

  async function connect(): Promise<TabState> {
    httpEndpoint = await discoverChromeEndpoint();
    const tab = await openNewTab(httpEndpoint);
    const state = await attachTab(tab.id, tab.webSocketDebuggerUrl);
    currentId = state.id;
    return state;
  }

  function ensureConnected(): Promise<CDPClient> {
    if (currentId) {
      const tab = tabs.get(currentId);
      if (tab) return Promise.resolve(tab.cdp);
    }
    if (connectPromise) return connectPromise.then((t) => t.cdp);
    connectPromise = connect().finally(() => { connectPromise = null; });
    return connectPromise.then((t) => t.cdp);
  }

  function hasLoadedPage(): boolean {
    if (!currentId) return false;
    const tab = tabs.get(currentId);
    if (!tab) return false;
    return tab.currentUrl !== "" && tab.currentUrl !== "about:blank";
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

  function listTabs(): TabSummary[] {
    return Array.from(tabs.values()).map((t) => ({
      id: t.id,
      label: t.label,
      url: t.currentUrl,
      current: t.id === currentId,
    }));
  }

  async function newTab(opts?: { label?: string }): Promise<TabSummary> {
    if (!httpEndpoint) httpEndpoint = await discoverChromeEndpoint();
    const tab = await openNewTab(httpEndpoint);
    const state = await attachTab(tab.id, tab.webSocketDebuggerUrl, opts?.label);
    // attachTab always mints a fresh id, so this is unconditionally a switch.
    refSelectors.clear();
    currentId = state.id;
    return { id: state.id, label: state.label, url: state.currentUrl, current: true };
  }

  function switchTab(tabId: string): TabSummary {
    const tab = tabs.get(tabId);
    if (!tab) throw new Error(`Unknown tab id: ${tabId}`);
    if (currentId !== tab.id) refSelectors.clear();
    currentId = tab.id;
    return { id: tab.id, label: tab.label, url: tab.currentUrl, current: true };
  }

  async function closeTabById(tabId?: string): Promise<void> {
    const tab = requireTab(tabId);
    tab.cdp.close();
    if (httpEndpoint) {
      await closeTab(httpEndpoint, tab.targetId).catch(() => {});
    }
    tabs.delete(tab.id);
    if (currentId === tab.id) {
      const next = tabs.values().next().value;
      currentId = next ? next.id : null;
      refSelectors.clear();
    }
  }

  function currentTabId(): string | null {
    return currentId;
  }

  function dispose(): void {
    disposed = true;
    refSelectors.clear();
    for (const tab of tabs.values()) {
      tab.cdp.close();
      if (httpEndpoint) closeTab(httpEndpoint, tab.targetId).catch(() => {});
    }
    tabs.clear();
    currentId = null;
  }

  return {
    ensureConnected,
    hasLoadedPage,
    updateRefs,
    resolveSelector,
    listTabs,
    newTab,
    switchTab,
    closeTab: closeTabById,
    currentTabId,
    dispose,
    get isDisposed() {
      return disposed;
    },
  };
}
