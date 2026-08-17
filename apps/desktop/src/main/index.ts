// The inteligir desktop shell.
//
// One window on the local server, and nothing else: no vault, no agent, no
// index and no renderer of its own. The window's whole security surface is the
// ORIGIN PIN (origin-pin.ts) — it loads exactly one origin, top-level
// navigation away goes to the system browser, and `window.open` is denied
// unconditionally. Everything imperative here delegates its decisions to that
// module and to server-target.ts / server-paths.ts, all of which are pure and
// unit-tested; this file is wiring.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  nativeImage,
  nativeTheme,
  shell,
  Tray,
  type MenuItemConstructorOptions,
} from "electron";
import { classifyNavigation, classifyWindowOpen } from "./origin-pin";
import {
  resolveAppCheckoutDir,
  resolveServerEntry,
  resolveServerRuntime,
  serverProcessEnv,
} from "./server-paths";
import {
  createSupervisor,
  DEFAULT_SUPERVISOR_LIMITS,
  type SupervisedChild,
  type SupervisorState,
} from "./server-supervisor";
import {
  healthUrl,
  planServerStart,
  resolveServerTarget,
  windowUrl,
  type ServerTarget,
} from "./server-target";

const APP_DISPLAY_NAME = app.isPackaged ? "Inteligir" : "Inteligir (Dev)";
const HEALTH_TIMEOUT_MS = 2_000;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
/** Null while the shell adopted a server it did not start — quitting must
 *  never stop a process someone else owns. */
let supervisor: ReturnType<typeof createSupervisor> | null = null;
let dataDir: string | null = null;

process.on("uncaughtException", (error) => {
  console.error("[desktop] uncaught exception:", error);
  dialog.showErrorBox(
    "A JavaScript error occurred in the main process",
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
});

process.on("unhandledRejection", (reason) => {
  console.error("[desktop] unhandled rejection:", reason);
});

// ---------------------------------------------------------------------------
// The server
// ---------------------------------------------------------------------------

async function healthAnswered(origin: string): Promise<boolean> {
  try {
    const response = await fetch(healthUrl(origin), {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function spawnServerChild(entryPath: string, target: ServerTarget): SupervisedChild {
  const runtime = resolveServerRuntime({ isPackaged: app.isPackaged, execPath: process.execPath });
  const child = spawn(runtime.executablePath, [entryPath], {
    // The shell's resolution is handed down whole. The child re-deriving any
    // of it would be a second answer to a question already asked — and its
    // cwd is this process's, not the app checkout's, so a re-derived dev
    // instance would not even be the same one.
    env: serverProcessEnv(process.env, runtime.mode, {
      INTELIGIR_DATA_DIR: target.dataDir,
      INTELIGIR_PORT: String(target.port),
      INTELIGIR_VAULT_DIR: target.vaultDir,
    }),
    stdio: ["ignore", "inherit", "inherit"],
  });
  return {
    get pid() {
      return child.pid;
    },
    kill: (signal) => child.kill(signal),
    onExit: (listener) => {
      child.once("exit", listener);
    },
  };
}

async function startServer(target: ServerTarget): Promise<void> {
  const origin = target.origin;
  if (planServerStart(await healthAnswered(origin)) === "adopt") {
    console.log(`[desktop] a server is already listening on ${origin} — adopting it`);
    return;
  }
  const entryPath = resolveServerEntry(app.getAppPath());
  if (!existsSync(entryPath)) {
    throw new Error(`the bundled server is missing (${entryPath}) — this install is incomplete`);
  }
  supervisor = createSupervisor(
    {
      spawnServer: () => spawnServerChild(entryPath, target),
      probeHealth: () => healthAnswered(origin),
      delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      schedule: (intervalMs, tick) => {
        const timer = setInterval(tick, intervalMs);
        return () => clearInterval(timer);
      },
      log: (message) => console.log(`[desktop] ${message}`),
    },
    DEFAULT_SUPERVISOR_LIMITS,
  );
  supervisor.onStateChanged(onServerStateChanged);
  await supervisor.start();
}

function onServerStateChanged(state: SupervisorState): void {
  if (state.kind === "up") {
    mainWindow?.webContents.reload();
    return;
  }
  if (state.kind === "failed") {
    dialog.showErrorBox("Inteligir stopped", state.reason);
  }
}

/** Where the RUNNING server keeps its data. Asked of it rather than taken from
 *  the shell's own resolution, because an adopted server is one the shell did
 *  not configure — "Open Data Folder" must open the folder in use, not the one
 *  a spawn would have used. */
async function fetchDataDir(origin: string): Promise<void> {
  try {
    const response = await fetch(`${origin}/api/v1/system/status`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "dataDir" in body) {
      const value: unknown = Reflect.get(body, "dataDir");
      dataDir = typeof value === "string" ? value : null;
    }
  } catch {
    dataDir = null;
  }
}

// ---------------------------------------------------------------------------
// The window, menu and tray
// ---------------------------------------------------------------------------

function createWindow(origin: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#141415" : "#f0f2f2",
    autoHideMenuBar: true,
    title: APP_DISPLAY_NAME,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  window.webContents.setWindowOpenHandler((details) => {
    if (classifyWindowOpen(details.url) === "deny-and-open-external") {
      void shell.openExternal(details.url);
    }
    return { action: "deny" };
  });

  const guardNavigation = (event: Electron.Event, url: string): void => {
    const verdict = classifyNavigation(url, origin);
    if (verdict === "allow") {
      return;
    }
    event.preventDefault();
    if (verdict === "block-and-open-external") {
      void shell.openExternal(url);
    }
  };
  window.webContents.on("will-navigate", guardNavigation);
  window.webContents.on("will-redirect", guardNavigation);

  window.on("page-title-updated", (event) => {
    event.preventDefault();
    window.setTitle(APP_DISPLAY_NAME);
  });

  window.once("ready-to-show", () => {
    window.show();
  });
  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  void window.loadURL(windowUrl(origin));
  return window;
}

function showMainWindow(origin: string): BrowserWindow {
  const existing = mainWindow;
  if (existing === null) {
    mainWindow = createWindow(origin);
    return mainWindow;
  }
  if (existing.isMinimized()) {
    existing.restore();
  }
  existing.show();
  existing.focus();
  app.focus();
  return existing;
}

function openDataDir(): void {
  if (dataDir === null) {
    dialog.showErrorBox("Inteligir", "The server has not reported its data directory yet.");
    return;
  }
  void shell.openPath(dataDir);
}

function configureApplicationMenu(origin: string): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { label: "Open Data Folder", click: () => openDataDir() },
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
    { label: "File", submenu: [{ role: "close" }] },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        {
          label: "Open in Browser",
          click: () => {
            void shell.openExternal(windowUrl(origin));
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** Tray icon, sized and marked as a template so macOS tints it for the menu
 *  bar rather than rendering the full-colour app icon. */
function createTray(origin: string): Tray | null {
  const icon = nativeImage
    .createFromPath(join(app.getAppPath(), "resources", "icon.png"))
    .resize({ width: 16, height: 16 });
  if (icon.isEmpty()) {
    console.error("[desktop] tray icon missing — skipping the tray");
    return null;
  }
  icon.setTemplateImage(true);
  const created = new Tray(icon);
  created.setToolTip(APP_DISPLAY_NAME);
  created.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Show ${APP_DISPLAY_NAME}`, click: () => showMainWindow(origin) },
      { label: "Hide", click: () => mainWindow?.hide() },
      { type: "separator" },
      { label: "Open Data Folder", click: () => openDataDir() },
      { type: "separator" },
      { role: "quit" },
    ]),
  );
  created.on("click", () => showMainWindow(origin));
  return created;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

async function onAppReady(target: ServerTarget): Promise<void> {
  app.setName(APP_DISPLAY_NAME);
  app.setAboutPanelOptions({
    applicationName: APP_DISPLAY_NAME,
    applicationVersion: app.getVersion(),
  });
  configureApplicationMenu(target.origin);
  await startServer(target);
  await fetchDataDir(target.origin);
  tray = createTray(target.origin);
  mainWindow = createWindow(target.origin);
}

const resolved = resolveServerTarget({
  isPackaged: app.isPackaged,
  appCheckoutDir: resolveAppCheckoutDir(app.getAppPath()),
  env: process.env,
});
if (resolved.kind === "refused") {
  dialog.showErrorBox("Inteligir failed to start", resolved.error);
  app.exit(2);
} else {
  const target = resolved.target;
  const origin = target.origin;

  app.on("activate", () => {
    showMainWindow(origin);
  });

  // The server is a child of this process, so quitting must take it with it —
  // and the SIGTERM its graceful shutdown listens for is what flushes the
  // vault's pending commit. `before-quit` is where that still has time to run.
  let teardown: Promise<void> | null = null;
  app.on("before-quit", (event) => {
    if (supervisor === null || teardown !== null) {
      return;
    }
    event.preventDefault();
    teardown = supervisor.stop().finally(() => {
      tray?.destroy();
      tray = null;
      app.quit();
    });
  });

  // Single instance: two shells would race for the same port and the loser
  // would adopt the winner's server, leaving two windows on one vault.
  if (!app.requestSingleInstanceLock()) {
    app.quit();
  } else {
    app.on("second-instance", () => {
      showMainWindow(origin);
    });
    app
      .whenReady()
      .then(() => onAppReady(target))
      .catch((error: unknown) => {
        console.error("[desktop] fatal startup error", error);
        dialog.showErrorBox(
          "Inteligir failed to start",
          error instanceof Error ? error.message : String(error),
        );
        app.quit();
      });
  }
}
