// wiring only; decisions live in browser-panel.ts.

import {
  BaseWindow,
  ipcMain,
  nativeTheme,
  session,
  WebContentsView,
  type IpcMainInvokeEvent,
} from "electron";
import type { ContractRouterClient } from "@orpc/contract";
import { createLocalClient } from "inteligir/server/local-client";
import type { LocalContract } from "@repo/api/local";
import { toErrorMessage } from "../types";
import { BROWSER_IPC } from "./browser-ipc";
import { browserChromePage, browserChromePreloadScript } from "./bundle-paths";
import type { LiveServer } from "./server-instance";
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
let sessionPrepared = false;

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
  handle.chrome.webContents.send(BROWSER_IPC.STATE, {
    url: contents.getURL(),
    title: contents.getTitle(),
    canGoBack: contents.navigationHistory.canGoBack(),
    canGoForward: contents.navigationHistory.canGoForward(),
    loading: contents.isLoading(),
  });
}

async function sendPageToAgent(
  handle: BrowserWindowHandle,
  server: LiveServer,
): Promise<{ ok: boolean; detail: string }> {
  const contents = handle.content.webContents;
  const url = contents.getURL();
  if (url.length === 0) {
    return { ok: false, detail: "nothing loaded" };
  }
  const selection = await readPageSelection(contents);
  const capture = { url, title: contents.getTitle(), selection };
  try {
    const api = apiClientFor(server);
    const { thread } = await api.threads.create({ title: capturePageTitle(capture) });
    await api.threads.send({
      threadId: thread.id,
      text: capturePageMessage(capture),
    });
    return { ok: true, detail: thread.id };
  } catch (error) {
    return { ok: false, detail: toErrorMessage(error) };
  }
}

// without a ceiling a wedged server leaves the chrome bar's IPC handler pending forever.
const CAPTURE_TIMEOUT_MS = 30_000;

// a page overriding `Selection.toString` with a loop would leave `executeJavaScript` pending forever.
const SELECTION_READ_TIMEOUT_MS = 1_000;

async function readPageSelection(contents: Electron.WebContents): Promise<string> {
  const evaluate = contents
    .executeJavaScript("String(getSelection())", false)
    .then((raw: unknown) => (typeof raw === "string" ? raw : ""))
    .catch(() => "");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve(""), SELECTION_READ_TIMEOUT_MS);
  });
  try {
    return await Promise.race([evaluate, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function apiClientFor(server: LiveServer): ContractRouterClient<LocalContract> {
  return createLocalClient({
    origin: server.origin,
    token: server.token,
    timeoutMs: CAPTURE_TIMEOUT_MS,
  });
}

function registerBrowserIpc(server: LiveServer): void {
  const fromChrome = (event: IpcMainInvokeEvent): BrowserWindowHandle | null => {
    if (browserHandle === null || event.sender !== browserHandle.chrome.webContents) {
      return null;
    }
    return browserHandle;
  };

  ipcMain.handle(BROWSER_IPC.NAVIGATE, (event, input: unknown) => {
    const handle = fromChrome(event);
    if (handle === null) {
      return;
    }
    const resolved = resolveAddressInput(typeof input === "string" ? input : "");
    if (resolved !== null) {
      void handle.content.webContents.loadURL(resolved);
    }
  });
  ipcMain.handle(BROWSER_IPC.BACK, (event) => {
    fromChrome(event)?.content.webContents.navigationHistory.goBack();
  });
  ipcMain.handle(BROWSER_IPC.FORWARD, (event) => {
    fromChrome(event)?.content.webContents.navigationHistory.goForward();
  });
  ipcMain.handle(BROWSER_IPC.RELOAD, (event) => {
    fromChrome(event)?.content.webContents.reload();
  });
  ipcMain.handle(BROWSER_IPC.SEND_TO_AGENT, async (event) => {
    const handle = fromChrome(event);
    if (handle === null) {
      return { ok: false, detail: "not the browser chrome" };
    }
    return sendPageToAgent(handle, server);
  });
}

function guardContentNavigation(event: Electron.Event, url: string): void {
  if (classifyBrowserNavigation(url) === "block") {
    event.preventDefault();
  }
}

// once per launch, not per window: `session.fromPartition` returns the same Session and `.on` appends.
function prepareBrowserSession(server: LiveServer): void {
  if (sessionPrepared) {
    return;
  }
  sessionPrepared = true;
  lockDownBrowserSession();
  registerBrowserIpc(server);
}

function createBrowserWindow(server: LiveServer): BrowserWindowHandle {
  prepareBrowserSession(server);

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
    webPreferences: chromeViewWebPreferences(browserChromePreloadScript()),
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
  // webContents.on is overloaded per event name, so a loop over the names does not typecheck.
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

  void chrome.webContents.loadFile(browserChromePage());
  void contents.loadURL(BROWSER_HOME_URL);
  return handle;
}

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
