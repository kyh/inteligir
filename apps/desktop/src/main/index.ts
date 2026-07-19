import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from "electron";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

import type { MenuItemConstructorOptions } from "electron";

declare const PROJECT_ROOT: string;
declare const BUNDLED_GOOGLE_OAUTH_CLIENT_ID: string | undefined;
declare const BUNDLED_GOOGLE_OAUTH_CLIENT_SECRET: string | undefined;

// Dev-only .env loader. In packaged builds PROJECT_ROOT points to a path that
// no longer exists on the user's machine, so loadEnvFile would always fail.
// Production reads from process.env directly (set by launcher/system).
if (!app.isPackaged) {
  try {
    process.loadEnvFile(path.resolve(PROJECT_ROOT, ".env"));
  } catch {
    // .env is optional in dev
  }
}

// Belt-and-suspenders (the host already refuses these flags in packaged
// builds — see @repo/agent/dev-flags.ts): a PACKAGED build launched
// with a dev-only flag in its environment is a misconfiguration at best and
// an attempt to force scripted-agent / fake-OAuth mode at worst. Fail loud
// and refuse to start rather than run with the flags silently ignored.
if (app.isPackaged) {
  const devOnlyFlags = ["INTELIGIR_FAUX_AGENT", "INTELIGIR_EMULATE_CONNECTORS"];
  const set = devOnlyFlags.filter((name) => (process.env[name] ?? "") !== "");
  if (set.length > 0) {
    const message = `Refusing to start: dev-only flag(s) set in a packaged build: ${set.join(", ")}`;
    console.error(`[desktop] ${message}`);
    dialog.showErrorBox("Inteligir refused to start", message);
    app.exit(1);
  }
}

import {
  deliverDeepLink,
  setDeepLinkFocusHandler,
} from "@repo/features/server/capture/deep-link-service";
import { createHost, type Host } from "@repo/features/server/boot/create-host";
import type { HostOptions } from "@repo/features/server/platform";
import {
  getRemoteAccessManager,
  type RemoteAccessManager,
} from "@repo/features/server/transport/remote-access-manager";
import { startWsHost, type WsHost } from "@repo/features/server/transport/ws-host";
import { isHttpUrl, isRecord, toErrorMessage } from "@repo/bridge/wire-helpers";

import {
  extractDeepLinkFromArgv,
  handleDeepLinkUrl,
  installDeepLinks,
  markDeepLinksReady,
} from "@/main/deep-link";
import { createElectronPlatform } from "@/main/electron-platform";
import { setupAutoUpdater, type Updater } from "@/main/updater";
import {
  mintHtmlAppToken,
  registerVaultAppProtocol,
  registerVaultAppScheme,
  revokeHtmlAppToken,
} from "@/main/vault-app-protocol";

const isDevelopment = !app.isPackaged;
const APP_DISPLAY_NAME = isDevelopment ? "Inteligir (Dev)" : "Inteligir";

// The vault-app:// scheme's privileges MUST be registered before app `ready`,
// so this runs at module load (the handler itself installs after ready, in
// onAppReady). See vault-app-protocol.ts.
registerVaultAppScheme();

// inteligir:// deep links: the open-url listener must exist before `ready`
// (macOS delivers a cold launch's URL early); raw URLs buffer until the host
// starts (markDeepLinksReady in onAppReady). See deep-link.ts.
installDeepLinks();

let mainWindow: BrowserWindow | null = null;
let host: Host | null = null;
let wsHost: WsHost | null = null;
let updater: Updater | null = null;

// ---------------------------------------------------------------------------
// Crash visibility — global error hooks before anything else can fail. The
// agent.log console mirror is wired inside createHost() (first thing in
// onAppReady), so startup crashes after that point land on disk too.
// ---------------------------------------------------------------------------

process.on("uncaughtException", (error) => {
  console.error("[desktop] uncaught exception:", error);
  // Preserve Electron's default behavior (which our listener suppresses):
  // surface the error dialog and keep the app alive.
  dialog.showErrorBox(
    "A JavaScript error occurred in the main process",
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
});

process.on("unhandledRejection", (reason) => {
  console.error("[desktop] unhandled rejection:", reason);
});

// ---------------------------------------------------------------------------
// Graceful shutdown — the single path every quit trigger funnels through:
// cmd+Q / window close (before-quit) and SIGINT/SIGTERM. Disposes the host
// (agent + executor daemon + vault watcher) with a hard timeout so a hung
// teardown can't wedge quit. Idempotent: concurrent triggers share one
// promise.
// ---------------------------------------------------------------------------

const SHUTDOWN_TIMEOUT_MS = 5_000;
let shutdownPromise: Promise<void> | null = null;
let shutdownFinished = false;

function runGracefulShutdown(): Promise<void> {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        console.error(
          `[desktop] graceful shutdown timed out after ${SHUTDOWN_TIMEOUT_MS}ms — quitting anyway`,
        );
        resolve();
      }, SHUTDOWN_TIMEOUT_MS);
    });
    try {
      await Promise.race([
        (async () => {
          // Transport first: no client can invoke into a disposing host.
          await (wsHost?.close() ?? Promise.resolve()).catch((error: unknown) => {
            console.error("[desktop] ws transport close failed:", error);
          });
          await (host?.dispose() ?? Promise.resolve()).catch((error: unknown) => {
            console.error("[desktop] shutdown failed:", error);
          });
        })(),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
      shutdownFinished = true;
    }
  })();
  return shutdownPromise;
}

// ---------------------------------------------------------------------------
// App identity & menu
// ---------------------------------------------------------------------------

function configureAppIdentity(): void {
  app.setName(APP_DISPLAY_NAME);
  app.setAboutPanelOptions({
    applicationName: APP_DISPLAY_NAME,
    applicationVersion: app.getVersion(),
  });
}

function configureApplicationMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        {
          label: "Check for Updates...",
          click: () => void updater?.checkForUpdates(),
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [{ role: "close" }],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// Host composition
// ---------------------------------------------------------------------------

/** The Google OAuth "Desktop app" client baked into this build by
 * electron-vite `define` (see electron.vite.config.ts for why shipping it is
 * fine). Declared `| undefined` and read behind `typeof` guards so the module
 * stays loadable where the defines don't exist (vitest runs the raw source);
 * the host falls back to INTELIGIR_GOOGLE_OAUTH_CLIENT_* env at call time. */
function hostOptionsFromDefines(): HostOptions {
  const clientId =
    typeof BUNDLED_GOOGLE_OAUTH_CLIENT_ID === "string" ? BUNDLED_GOOGLE_OAUTH_CLIENT_ID.trim() : "";
  const clientSecret =
    typeof BUNDLED_GOOGLE_OAUTH_CLIENT_SECRET === "string"
      ? BUNDLED_GOOGLE_OAUTH_CLIENT_SECRET.trim()
      : "";
  if (!clientId || !clientSecret) return {};
  return { bundledGoogleClient: { clientId, clientSecret } };
}

// ---------------------------------------------------------------------------
// Window creation
// ---------------------------------------------------------------------------

/**
 * Pick the window chrome color from the persisted theme so the pre-paint
 * background matches what the renderer will render (no dark flash in light
 * mode). Mirrors the renderer's default-to-light behaviour for unset/invalid.
 */
async function startupBackgroundColor(theHost: Host): Promise<string> {
  const uiState = await Promise.resolve(theHost.handlers.getUiState(undefined));
  const stored = isRecord(uiState) ? uiState["theme"] : undefined;
  const theme = stored === "dark" || stored === "system" ? stored : "light";
  const dark = theme === "dark" || (theme === "system" && nativeTheme.shouldUseDarkColors);
  return dark ? "#141415" : "#f0f2f2";
}

/** The ws endpoint + per-boot local token the renderer's Bridge dials with.
 * The preload fetches it over the one-shot `inteligir:bootstrap` sendSync
 * channel (registered in onAppReady), keeping the token out of the page URL,
 * navigation history, and the renderer's OS command line. */
type BridgeBootstrap = { url: string; token: string };

function createWindow(backgroundColor: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    backgroundColor,
    autoHideMenuBar: true,
    title: APP_DISPLAY_NAME,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(moduleDir, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  window.webContents.setWindowOpenHandler((details) => {
    if (isHttpUrl(details.url)) {
      void shell.openExternal(details.url);
    }
    return { action: "deny" };
  });

  // The app window loads exactly one origin: the electron-vite dev server in
  // dev, or the packaged file:// bundle in production. Any top-level navigation
  // away from it (a crafted link in a note, agent output, injected content) is
  // a phishing surface inside the product chrome, so we pin the window: allow
  // navigation that stays on the loaded origin (HMR relies on this in dev) and
  // block everything else, routing http(s) out to the system browser to match
  // the window-open handler above. `loadedUrlPrefix` is set at load time below.
  //
  // http(s) compares true URL origins — a raw startsWith on a prefix like
  // "http://localhost:5173" would also match "http://localhost:5173.evil.com".
  // file: URLs all parse to the opaque origin "null", so the packaged bundle
  // is matched by exact URL (plus a "#fragment" suffix for in-page anchors).
  let loadedUrlPrefix = "";
  const isSameOrigin = (candidate: string): boolean => {
    if (loadedUrlPrefix.length === 0) return false;
    let parsed: URL;
    let loaded: URL;
    try {
      parsed = new URL(candidate);
      loaded = new URL(loadedUrlPrefix);
    } catch {
      return false; // unparseable → not same origin
    }
    if (loaded.protocol === "file:") {
      return (
        parsed.protocol === "file:" &&
        (candidate === loadedUrlPrefix || candidate.startsWith(loadedUrlPrefix + "#"))
      );
    }
    return parsed.origin === loaded.origin;
  };
  const guardNavigation = (event: Electron.Event, url: string): void => {
    if (isSameOrigin(url)) return;
    event.preventDefault();
    if (isHttpUrl(url)) {
      void shell.openExternal(url);
    }
  };
  window.webContents.on("will-navigate", guardNavigation);
  window.webContents.on("will-redirect", guardNavigation);

  window.on("page-title-updated", (event) => {
    event.preventDefault();
    window.setTitle(APP_DISPLAY_NAME);
  });

  // Renderer crash recovery: log the reason (it lands in agent.log) and
  // reload. Deliberate teardowns aren't crashes; the reload cap stops a
  // crash-on-boot loop from spinning forever.
  let crashReloads = 0;
  window.webContents.on("render-process-gone", (_event, details) => {
    console.error(
      `[desktop] renderer process gone: reason=${details.reason} exitCode=${details.exitCode}`,
    );
    if (details.reason === "clean-exit" || details.reason === "killed") return;
    if (crashReloads >= 3) {
      console.error("[desktop] renderer crashed repeatedly — not reloading again (View > Reload)");
      return;
    }
    crashReloads += 1;
    window.webContents.reload();
  });

  window.once("ready-to-show", () => {
    window.show();
  });

  if (isDevelopment && process.env["ELECTRON_RENDERER_URL"]) {
    const rendererUrl = process.env["ELECTRON_RENDERER_URL"];
    loadedUrlPrefix = rendererUrl;
    void window.loadURL(rendererUrl);
  } else {
    const indexPath = path.join(moduleDir, "../renderer/index.html");
    loadedUrlPrefix = pathToFileURL(indexPath).href;
    void window.loadFile(indexPath);
  }

  if (isDevelopment) {
    window.webContents.on("before-input-event", (_event, input) => {
      if (input.key === "F12" && input.type === "keyDown") {
        window.webContents.toggleDevTools();
      }
    });
  }

  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  return window;
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

// Re-drives quit after a graceful shutdown, with an external watchdog.
// Chromium intercepts SIGTERM/SIGINT on its shutdown-detector thread (the
// Node-level signal handlers never fire) and starts its own quit; our
// before-quit preventDefault wedges that signal-initiated quit sequence, and
// the follow-up app.quit() then BLOCKS the main thread indefinitely inside
// Chromium (observed via `sample`: main thread parked in mach_msg deep in
// the quit call, windows and helpers already gone). A blocked JS thread can
// never run a setTimeout fallback, so the watchdog must live outside the
// process: a detached shell that re-signals us. A second SIGTERM is known to
// complete the wedged quit immediately; SIGKILL is the last resort. On a
// normal quit (cmd+Q) the process exits in milliseconds and the watchdog's
// signals hit a dead pid — a no-op.
function quitNow(): void {
  console.log("[desktop] graceful shutdown complete — quitting");
  if (process.platform !== "win32") {
    try {
      const watchdog = spawn(
        "/bin/sh",
        [
          "-c",
          `sleep 3; kill -TERM ${process.pid} 2>/dev/null; sleep 5; kill -KILL ${process.pid} 2>/dev/null`,
        ],
        { detached: true, stdio: "ignore" },
      );
      watchdog.unref();
    } catch (error) {
      console.error("[desktop] failed to start quit watchdog:", error);
    }
  }
  app.quit();
}

app.on("before-quit", (event) => {
  if (shutdownFinished) return;
  event.preventDefault();
  void runGracefulShutdown().then(() => quitNow());
});

// The renderer's first act is dialing the Bridge, so the ws server must be
// accepting connections before any window exists. Resolves with the bound
// port; rejects (→ the fatal-startup dialog) as soon as the bind FAILS — the
// server's error event lands in milliseconds, e.g. a stale instance still
// holding the port — with the timeout kept only as a backstop.
const WS_LISTEN_TIMEOUT_MS = 10_000;

function bindFailure(reason: string): Error {
  return new Error(
    `the WebSocket transport failed to bind (${reason}) — is another Inteligir instance running?`,
  );
}

function waitForWsPort(theWsHost: WsHost, manager: RemoteAccessManager): Promise<number> {
  const bound = theWsHost.port();
  if (bound !== null) return Promise.resolve(bound);
  const failed = manager.getListenError();
  if (failed !== null) return Promise.reject(bindFailure(failed));
  return new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(bindFailure(`no bind within ${WS_LISTEN_TIMEOUT_MS}ms`));
    }, WS_LISTEN_TIMEOUT_MS);
    const unsubscribe = manager.onChange(() => {
      const port = theWsHost.port();
      if (port !== null) {
        clearTimeout(timer);
        unsubscribe();
        resolve(port);
        return;
      }
      const error = manager.getListenError();
      if (error === null) return;
      clearTimeout(timer);
      unsubscribe();
      reject(bindFailure(error));
    });
  });
}

async function onAppReady(): Promise<void> {
  const electronPlatform = createElectronPlatform();
  const theHost = createHost(electronPlatform.platform, hostOptionsFromDefines());
  host = theHost;

  configureAppIdentity();
  configureApplicationMenu();

  // Transport fold: ONE WebSocket server carries the whole Bridge, before any
  // renderer can invoke a channel. The html-app token mint/revoke
  // (DESKTOP_SHELL_METHODS — deliberately absent from the platform-agnostic
  // host handler map) ride along as shellHandlers.
  const remoteAccess = getRemoteAccessManager();
  updater = setupAutoUpdater({ isDevelopment });
  const theWsHost = startWsHost({
    host: theHost,
    validator: remoteAccess.validator,
    manager: remoteAccess,
    shellHandlers: {
      mintHtmlAppToken: () => mintHtmlAppToken(),
      revokeHtmlAppToken: (raw: unknown) => {
        if (isRecord(raw) && typeof raw.token === "string") revokeHtmlAppToken(raw.token);
      },
    },
  });
  wsHost = theWsHost;

  registerVaultAppProtocol();

  // Independent awaits — the ws bind and the ui-state read overlap.
  const [port, backgroundColor] = await Promise.all([
    waitForWsPort(theWsHost, remoteAccess),
    startupBackgroundColor(theHost),
  ]);
  const bootstrap: BridgeBootstrap = {
    url: `ws://127.0.0.1:${port}`,
    token: remoteAccess.getLocalToken(),
  };

  // One-shot BOOTSTRAP shell channel — NOT a Bridge data channel (the Bridge
  // data plane stays WS-only). The preload sendSync's the ws endpoint +
  // per-boot local token here; passing them via additionalArguments instead
  // would put the token on the renderer's OS command line, readable by every
  // local user via `ps`.
  ipcMain.on("inteligir:bootstrap", (event) => {
    event.returnValue = bootstrap;
  });

  mainWindow = createWindow(backgroundColor);
  electronPlatform.setTargetWindow(mainWindow);

  theHost.start();

  // Deep links: the host (vault + capture inbox) is up — flush every URL that
  // arrived during boot into the dispatcher, and wire how nav verbs surface
  // the window. Captures deliberately never steal focus (background capture
  // is the point); nav exists to be looked at.
  setDeepLinkFocusHandler(() => focusMainWindow());
  markDeepLinksReady(deliverDeepLink);
  // win/linux cold launch: the URL rides our own argv (macOS uses open-url).
  const launchUrl = extractDeepLinkFromArgv(process.argv);
  if (launchUrl !== null) handleDeepLinkUrl(launchUrl);
}

function focusMainWindow(): void {
  const window = mainWindow;
  if (window === null) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  app.focus();
}

// Single instance: deep links demand it — macOS routes open-url to the
// running instance, and win/linux deliver the URL on the SECOND instance's
// argv, which must be forwarded here and the duplicate quit. This also
// upgrades the stale-instance UX: the launch now focuses the existing window
// instead of dying on the ws-port bind (that failure stays as backstop).
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    focusMainWindow();
    const url = extractDeepLinkFromArgv(argv);
    if (url !== null) handleDeepLinkUrl(url);
  });

  app
    .whenReady()
    .then(onAppReady)
    .catch((error: unknown) => {
      console.error("[desktop] fatal startup error", error);
      dialog.showErrorBox("Inteligir failed to start", toErrorMessage(error));
      app.quit();
    });
}

// POSIX signals must take the same graceful path as before-quit. In practice
// Chromium's shutdown-detector thread usually catches SIGTERM/SIGINT before
// Node does (so these handlers rarely fire and quit arrives via before-quit
// above); they remain as a belt-and-braces path for environments where
// Chromium does not install its detectors.
const handleSignal = (signal: NodeJS.Signals) => {
  console.log(`[desktop] received ${signal} — shutting down`);
  void runGracefulShutdown().then(() => quitNow());
};
process.on("SIGINT", handleSignal);
process.on("SIGTERM", handleSignal);
