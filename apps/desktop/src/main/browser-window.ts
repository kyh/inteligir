// The in-app browser WINDOW — wiring only; every decision lives in
// browser-panel.ts. A separate shell-owned window so the app window's origin
// pin survives verbatim: two webContents, the shell's own chrome bar (the one
// preload in this process) above a sandboxed, preload-less content view on its
// own storage partition. "Send page to agent" runs entirely in this process:
// the shell reads the page's url/title/selection and drives the local app's
// ORDINARY typed routes over loopback — the app window gains no IPC and the
// server gains no new surface.

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
  handle.chrome.webContents.send(BROWSER_IPC.STATE, {
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
  const selection = await readPageSelection(contents);
  const capture = { url, title: contents.getTitle(), selection };
  try {
    const api = apiClientFor(server);
    const { thread } = await api.threads.create({ title: capturePageTitle(capture) });
    await api.threads.send({
      threadId: thread.id,
      text: capturePageMessage(capture),
      mode: "queue-if-active",
    });
    return { ok: true, detail: thread.id };
  } catch (error) {
    // A refusal THROWS, so both halves land here — and the chrome bar shows
    // whichever sentence the server sent rather than a status number.
    return { ok: false, detail: toErrorMessage(error) };
  }
}

/** A ceiling on the capture call. Without one a wedged server leaves the
 *  chrome bar's IPC handler pending forever and the button spinning. */
const CAPTURE_TIMEOUT_MS = 30_000;

/** The same reasoning applied to the PAGE half. The content view runs arbitrary
 *  pages: one overriding `Selection.toString` (or `String`) with a loop would
 *  leave `executeJavaScript` pending forever — hanging the IPC handler and
 *  spinning the button exactly as a wedged server would. A selection read is
 *  near-instant, so this bounds it and falls back to no selection (url + title
 *  still capture). */
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

/** The typed client against the local server, carrying this instance's device
 *  token. "Send to agent" is a MAIN-process call — the browser view has no
 *  preload and never sees the credential. */
function apiClientFor(server: LiveServer): ContractRouterClient<LocalContract> {
  return createLocalClient({
    origin: server.origin,
    token: server.token,
    timeoutMs: CAPTURE_TIMEOUT_MS,
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

  void chrome.webContents.loadFile(browserChromePage());
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
