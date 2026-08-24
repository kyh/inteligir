// The in-app browser WINDOW — wiring only; every decision lives in
// browser-panel.ts. A separate shell-owned window so the app window's origin
// pin survives verbatim: two webContents, the shell's own chrome bar (the one
// preload in this process) above a sandboxed, preload-less content view on its
// own storage partition. "Send page to agent" runs entirely in this process:
// the shell reads the page's url/title/selection and drives the local app's
// ORDINARY typed routes over loopback — the app window gains no IPC and the
// server gains no new surface.

import { join } from "node:path";
import {
  BaseWindow,
  ipcMain,
  nativeTheme,
  session,
  WebContentsView,
  type IpcMainInvokeEvent,
} from "electron";
import { authorizationHeader } from "@repo/app/node/server-file";
import { createApiClient, type ApiClient } from "@repo/server-contract/client";
import type { LiveServer } from "./server-target";
import {
  BROWSER_CHROME_HEIGHT,
  BROWSER_HOME_URL,
  BROWSER_PARTITION,
  capturePageMessage,
  capturePageTitle,
  chromeViewWebPreferences,
  classifyBrowserNavigation,
  classifyBrowserWindowOpen,
  contentViewWebPreferences,
  resolveAddressInput,
} from "./browser-panel";

interface BrowserWindowHandle {
  window: BaseWindow;
  chrome: WebContentsView;
  content: WebContentsView;
}

let browserHandle: BrowserWindowHandle | null = null;
let ipcRegistered = false;

/** The browser partition denies EVERY web permission — the content view
 *  renders arbitrary pages, and none of them is owed a microphone or a
 *  device picker. Downloads are cancelled too: this is a reading surface,
 *  and a silent write into ~/Downloads is not in its charter. */
function lockDownBrowserSession(): Electron.Session {
  const browserSession = session.fromPartition(BROWSER_PARTITION);
  browserSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  browserSession.setPermissionCheckHandler(() => false);
  browserSession.setDevicePermissionHandler(() => false);
  browserSession.on("will-download", (event, item) => {
    console.warn(`[desktop] browser refused a download: ${item.getURL()}`);
    event.preventDefault();
  });
  return browserSession;
}

function layout(handle: BrowserWindowHandle): void {
  const { width, height } = handle.window.getContentBounds();
  handle.chrome.setBounds({ x: 0, y: 0, width, height: BROWSER_CHROME_HEIGHT });
  handle.content.setBounds({
    x: 0,
    y: BROWSER_CHROME_HEIGHT,
    width,
    height: Math.max(0, height - BROWSER_CHROME_HEIGHT),
  });
}

function pushChromeState(handle: BrowserWindowHandle): void {
  const contents = handle.content.webContents;
  handle.chrome.webContents.send("inteligir-browser:state", {
    url: contents.getURL(),
    title: contents.getTitle(),
    canGoBack: contents.navigationHistory.canGoBack(),
    canGoForward: contents.navigationHistory.canGoForward(),
    loading: contents.isLoading(),
  });
}

/**
 * "Send page to agent": read {url, title, selection} off the content view —
 * the shell driving its own content, never the reverse — and create an action
 * carrying it through the SAME typed routes every client uses. The send
 * starts the agent on the page, which is the Inteligir semantic.
 */
async function sendPageToAgent(
  handle: BrowserWindowHandle,
  server: LiveServer,
): Promise<{ ok: boolean; detail: string }> {
  const contents = handle.content.webContents;
  const url = contents.getURL();
  if (url.length === 0) {
    return { ok: false, detail: "nothing loaded" };
  }
  let selection = "";
  try {
    const raw: unknown = await contents.executeJavaScript("String(getSelection())", false);
    selection = typeof raw === "string" ? raw : "";
  } catch {
    // A page that refuses script evaluation still captures by url + title.
  }
  const capture = { url, title: contents.getTitle(), selection };
  try {
    const api = apiClientFor(server);
    const created = await api.threads.create.$post({
      json: { title: capturePageTitle(capture) },
    });
    if (!created.ok) {
      return { ok: false, detail: `create answered ${created.status}` };
    }
    const { thread } = await created.json();
    const sent = await api.threads.send.$post({
      json: {
        threadId: thread.id,
        text: capturePageMessage(capture),
        mode: "queue-if-active",
      },
    });
    if (!sent.ok) {
      return { ok: false, detail: `send answered ${sent.status}` };
    }
    return { ok: true, detail: thread.id };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

/** The typed client against the local server, carrying this instance's device
 *  token. "Send to agent" is a MAIN-process call — the browser view has no
 *  preload and never sees the credential. */
function apiClientFor(server: LiveServer): ApiClient {
  return createApiClient(server.origin, {
    fetch: (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("authorization", authorizationHeader(server.token));
      return fetch(input, { ...init, headers });
    },
  });
}

/** One registration for the process; each handler re-resolves the live handle
 *  and refuses any sender that is not the shell's own chrome bar — the app
 *  window has no preload, but a guard that checks is one that cannot rot. */
function registerBrowserIpc(server: LiveServer): void {
  if (ipcRegistered) {
    return;
  }
  ipcRegistered = true;

  const fromChrome = (event: IpcMainInvokeEvent): BrowserWindowHandle | null => {
    if (browserHandle === null || event.sender !== browserHandle.chrome.webContents) {
      return null;
    }
    return browserHandle;
  };

  ipcMain.handle("inteligir-browser:navigate", (event, input: unknown) => {
    const handle = fromChrome(event);
    if (handle === null) {
      return;
    }
    const resolved = resolveAddressInput(typeof input === "string" ? input : "");
    if (resolved !== null) {
      void handle.content.webContents.loadURL(resolved);
    }
  });
  ipcMain.handle("inteligir-browser:back", (event) => {
    fromChrome(event)?.content.webContents.navigationHistory.goBack();
  });
  ipcMain.handle("inteligir-browser:forward", (event) => {
    fromChrome(event)?.content.webContents.navigationHistory.goForward();
  });
  ipcMain.handle("inteligir-browser:reload", (event) => {
    fromChrome(event)?.content.webContents.reload();
  });
  ipcMain.handle("inteligir-browser:send-to-agent", async (event) => {
    const handle = fromChrome(event);
    if (handle === null) {
      return { ok: false, detail: "not the browser chrome" };
    }
    return sendPageToAgent(handle, server);
  });
}

/** Redirects are guarded like navigations: Chromium blocks most cross-scheme
 *  redirects itself, but the shell's own answer must not depend on it. */
function guardContentNavigation(event: Electron.Event, url: string): void {
  if (classifyBrowserNavigation(url) === "block") {
    event.preventDefault();
  }
}

function createBrowserWindow(server: LiveServer): BrowserWindowHandle {
  lockDownBrowserSession();
  registerBrowserIpc(server);

  const window = new BaseWindow({
    width: 1100,
    height: 760,
    minWidth: 600,
    minHeight: 400,
    title: "Browser",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#141415" : "#f0f2f2",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 14 },
  });

  const chrome = new WebContentsView({
    webPreferences: chromeViewWebPreferences(join(__dirname, "browser-preload.cjs")),
  });
  const content = new WebContentsView({
    webPreferences: contentViewWebPreferences(),
  });
  window.contentView.addChildView(chrome);
  window.contentView.addChildView(content);

  const handle: BrowserWindowHandle = { window, chrome, content };
  layout(handle);
  window.on("resize", () => layout(handle));

  const contents = content.webContents;
  contents.setWindowOpenHandler((details) => {
    if (classifyBrowserWindowOpen(details.url) === "deny-and-navigate") {
      void contents.loadURL(details.url);
    }
    return { action: "deny" };
  });
  contents.on("will-navigate", guardContentNavigation);
  contents.on("will-redirect", guardContentNavigation);
  // Spelled out one by one: webContents.on is overloaded per event name, so a
  // loop over a union of names does not typecheck.
  const push = (): void => pushChromeState(handle);
  contents.on("did-navigate", push);
  contents.on("did-navigate-in-page", push);
  contents.on("page-title-updated", push);
  contents.on("did-start-loading", push);
  contents.on("did-stop-loading", push);

  window.on("closed", () => {
    if (browserHandle === handle) {
      browserHandle = null;
    }
  });

  void chrome.webContents.loadFile(join(__dirname, "browser-chrome.html"));
  void contents.loadURL(BROWSER_HOME_URL);
  return handle;
}

/** Open the browser window, or focus the one already open. */
export function showBrowserWindow(server: LiveServer): void {
  if (browserHandle === null) {
    browserHandle = createBrowserWindow(server);
    return;
  }
  if (browserHandle.window.isMinimized()) {
    browserHandle.window.restore();
  }
  browserHandle.window.show();
  browserHandle.window.focus();
}
