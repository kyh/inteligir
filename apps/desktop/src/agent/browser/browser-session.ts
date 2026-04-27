/**
 * Browser session — CDP WebSocket connections to one or more Chrome tabs.
 *
 * Manages a set of agent-owned tabs identified by stable ids (t1, t2, ...).
 * One tab is "current" at any time; existing actions operate on it. Tab
 * management actions (tab_new, tab_switch, ...) manipulate the set.
 *
 * Also keeps a ring buffer of recent network requests per tab, enabled when
 * a tab is opened so `network_log` always has data to return.
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

export interface NetworkRequest {
  url: string;
  method: string;
  resourceType: string;
  status?: number;
  startedAt: number;
}

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
  /** All known refs from the most recent snapshot of the current tab. */
  getRefs(): ReadonlyMap<string, string>;
  /** Recent network requests for the current tab (most recent last). */
  getNetworkLog(): readonly NetworkRequest[];

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

const NETWORK_LOG_LIMIT = 200;

interface TabState {
  id: string;
  label?: string;
  targetId: string;
  cdp: CDPClient;
  currentUrl: string;
  refs: Map<string, string>;
  network: NetworkRequest[];
}

export function createBrowserSession(): BrowserSession {
  const tabs = new Map<string, TabState>();
  let currentId: string | null = null;
  let nextTabNumber = 1;
  let connectPromise: Promise<TabState> | null = null;
  let httpEndpoint: string | null = null;
  let disposed = false;

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
    await cdp.send("Network.enable");

    const state: TabState = {
      id,
      label,
      targetId,
      cdp,
      currentUrl: "",
      refs: new Map<string, string>(),
      network: [],
    };

    cdp.on("Page.frameNavigated", (params) => {
      const frame = params["frame"] as Record<string, unknown> | undefined;
      if (!frame || !frame["parentId"]) {
        state.currentUrl = (frame?.["url"] as string) ?? "";
        state.refs.clear();
      }
    });

    cdp.on("Page.navigatedWithinDocument", () => {
      state.refs.clear();
    });

    cdp.on("Network.requestWillBeSent", (params) => {
      const request = params["request"] as Record<string, unknown> | undefined;
      if (!request) return;
      const entry: NetworkRequest = {
        url: (request["url"] as string) ?? "",
        method: (request["method"] as string) ?? "GET",
        resourceType: (params["type"] as string) ?? "Other",
        startedAt: Date.now(),
      };
      state.network.push(entry);
      if (state.network.length > NETWORK_LOG_LIMIT) {
        state.network.splice(0, state.network.length - NETWORK_LOG_LIMIT);
      }
    });

    cdp.on("Network.responseReceived", (params) => {
      const response = params["response"] as Record<string, unknown> | undefined;
      if (!response) return;
      const url = response["url"] as string;
      const status = response["status"] as number;
      // Match by URL — last unmatched request to that URL gets the status
      for (let i = state.network.length - 1; i >= 0; i--) {
        const entry = state.network[i];
        if (entry && entry.url === url && entry.status === undefined) {
          entry.status = status;
          break;
        }
      }
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
    const tab = requireTab();
    tab.refs.clear();
    for (const { ref, selector } of refs) {
      tab.refs.set(ref, selector);
    }
  }

  function resolveSelector(selector: string): string {
    if (!selector.startsWith("@e")) return selector;
    const tab = requireTab();
    const resolved = tab.refs.get(selector);
    if (resolved) return resolved;
    throw new Error(
      `Unknown ref "${selector}". Run the "snapshot" action first to get element refs.`,
    );
  }

  function getRefs(): ReadonlyMap<string, string> {
    const tab = requireTab();
    return tab.refs;
  }

  function getNetworkLog(): readonly NetworkRequest[] {
    const tab = requireTab();
    return tab.network;
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
    currentId = state.id;
    return { id: state.id, label: state.label, url: state.currentUrl, current: true };
  }

  function switchTab(tabId: string): TabSummary {
    const tab = tabs.get(tabId);
    if (!tab) throw new Error(`Unknown tab id: ${tabId}`);
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
    }
  }

  function currentTabId(): string | null {
    return currentId;
  }

  function dispose(): void {
    disposed = true;
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
    getRefs,
    getNetworkLog,
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
