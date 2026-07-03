import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, Menu, nativeTheme, shell } from "electron";

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

import { createHost, type Host } from "@repo/host/create-host";
import type { HostOptions } from "@repo/host/platform";
import { isHttpUrl, isRecord, toErrorMessage } from "@repo/features/ipc";

import { createElectronPlatform } from "@/main/electron-platform";
import { foldHostIntoIpc } from "@/main/host-fold";
import { setupAutoUpdater, type Updater } from "@/main/updater";

const isDevelopment = !app.isPackaged;
const APP_DISPLAY_NAME = isDevelopment ? "Inteligir (Dev)" : "Inteligir";

let mainWindow: BrowserWindow | null = null;
let host: Host | null = null;
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
// cmd+Q / window close (before-quit), SIGINT/SIGTERM, and the auto-update
// install. Disposes the host (agent + executor daemon + vault watcher) with a
// hard timeout so a hung teardown can't wedge quit. Idempotent: concurrent
// triggers share one promise.
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
        (host?.dispose() ?? Promise.resolve()).catch((error: unknown) => {
          console.error("[desktop] shutdown failed:", error);
        }),
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
    void window.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void window.loadFile(path.join(moduleDir, "../renderer/index.html"));
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
// normal quit (cmd+Q, auto-update) the process exits in milliseconds and the
// watchdog's signals hit a dead pid — a no-op.
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

async function onAppReady(): Promise<void> {
  const electronPlatform = createElectronPlatform();
  const theHost = createHost(electronPlatform.platform, hostOptionsFromDefines());
  host = theHost;

  configureAppIdentity();
  configureApplicationMenu();

  // Transport fold + the desktop-only updater overlay, before any renderer
  // can invoke a channel.
  foldHostIntoIpc(theHost);
  updater = setupAutoUpdater({ isDevelopment, gracefulShutdown: runGracefulShutdown });

  mainWindow = createWindow(await startupBackgroundColor(theHost));
  electronPlatform.setTargetWindow(mainWindow);

  theHost.start();
}

app
  .whenReady()
  .then(onAppReady)
  .catch((error: unknown) => {
    console.error("[desktop] fatal startup error", error);
    dialog.showErrorBox("Inteligir failed to start", toErrorMessage(error));
    app.quit();
  });

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
