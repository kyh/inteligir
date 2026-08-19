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
  session,
  shell,
  Tray,
  type MenuItemConstructorOptions,
} from "electron";
import {
  systemIdentityResponseSchema,
  type SystemIdentityResponse,
} from "@repo/server-contract/routes";
import {
  classifyNavigation,
  classifyPermission,
  classifyWindowOpen,
  decideExternalOpen,
} from "./origin-pin";
import {
  resolveAppCheckoutDir,
  resolveServerEntry,
  resolveServerRuntime,
  serverProcessEnv,
  sessionPartition,
} from "./server-paths";
import {
  createSupervisor,
  DEFAULT_SUPERVISOR_LIMITS,
  type SupervisedChild,
  type SupervisorState,
} from "./server-supervisor";
import {
  describeIdentityVerdict,
  identityUrl,
  newIdentityChallenge,
  planServerStart,
  resolveServerTarget,
  verifyServerIdentity,
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
/** The last real input the page saw, for the user-activation gate on
 *  page-initiated external opens (origin-pin.ts::decideExternalOpen). */
let lastInputAt: number | null = null;

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

/**
 * IS THE SERVER ON THIS ORIGIN OURS? Health alone cannot say — a loopback port
 * is first-come-first-served — so every probe is an identity challenge, not a
 * liveness check. Used for the pre-flight AND as the supervisor's own
 * `probeHealth`, because a child that loses a race for the port would
 * otherwise leave the supervisor reporting "up" about a stranger.
 */
async function verifiedServerAnswered(origin: string, dataDir: string): Promise<boolean> {
  const challenge = newIdentityChallenge();
  let answer: SystemIdentityResponse | null = null;
  try {
    const response = await fetch(identityUrl(origin, challenge), {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (response.ok) {
      const body: unknown = await response.json();
      answer = systemIdentityResponseSchema.safeParse(body).data ?? null;
    }
  } catch {
    answer = null;
  }
  const verdict = verifyServerIdentity({ dataDir, challenge, answer });
  if (
    verdict.kind !== "verified" &&
    verdict.kind !== "unreachable" &&
    verdict.kind !== "no-secret"
  ) {
    // A responder that is REACHABLE but not ours is the case worth a log line:
    // something is on our port and it is not the vault we mean.
    console.warn(`[desktop] ${describeIdentityVerdict(verdict, origin)}`);
  }
  return verdict.kind === "verified";
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
  if (planServerStart(await verifiedServerAnswered(target.origin, target.dataDir)) === "adopt") {
    console.log(`[desktop] adopting the server already serving ${target.dataDir}`);
    return;
  }
  const entryPath = resolveServerEntry(app.getAppPath());
  if (!existsSync(entryPath)) {
    throw new Error(`the bundled server is missing (${entryPath}) — this install is incomplete`);
  }
  supervisor = createSupervisor(
    {
      spawnServer: () => spawnServerChild(entryPath, target),
      probeHealth: () => verifiedServerAnswered(target.origin, target.dataDir),
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

// The shell no longer asks the running server where its data lives. It used to,
// because an adopted server was one the shell had not configured — but adoption
// now REQUIRES the responder to name this shell's own data dir and prove it
// (`verifyServerIdentity`), so the two can no longer differ, and `target` is
// the answer without trusting a value off the wire.

// ---------------------------------------------------------------------------
// The window, menu and tray
// ---------------------------------------------------------------------------

/**
 * Deny every permission the product does not use, on the window's OWN session,
 * and grant the one it does (`media`, dictation) ONLY to the pinned origin.
 * Electron grants most permissions by default to whatever a window loads, so
 * an unset handler is a standing grant. Both handlers are required and both
 * are ORIGIN-SCOPED: the request handler answers a prompt (its origin is
 * `details.requestingUrl`), the check handler answers a silent capability
 * query (`navigator.permissions.query`, `getUserMedia`'s pre-flight — its
 * origin arrives as the third argument).
 */
function lockDownSession(partition: string, appOrigin: string): Electron.Session {
  const windowSession = session.fromPartition(partition);
  windowSession.setPermissionRequestHandler((_contents, permission, callback, details) => {
    callback(classifyPermission(permission, details.requestingUrl, appOrigin));
  });
  windowSession.setPermissionCheckHandler((_contents, permission, requestingOrigin) =>
    classifyPermission(permission, requestingOrigin, appOrigin),
  );
  // Serial/HID/USB device pickers, which the permission handlers above do not
  // cover.
  windowSession.setDevicePermissionHandler(() => false);
  return windowSession;
}

/** Hand a PAGE-INITIATED url to the system browser, or refuse it. Menu and
 *  tray items call `shell.openExternal` directly: a menu click is the gesture,
 *  and it produces no page input to measure. */
function openExternalFromPage(url: string): void {
  const decision = decideExternalOpen({ url, lastInputAt, now: Date.now() });
  if (!decision.allowed) {
    console.warn(`[desktop] refused to open ${url} externally (${decision.reason})`);
    return;
  }
  void shell.openExternal(url);
}

function createWindow(target: ServerTarget): BrowserWindow {
  const partition = sessionPartition(target.dataDir);
  lockDownSession(partition, target.origin);
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
      // Never the default session: `http://127.0.0.1:<port>` is a shared name
      // rather than an identity, so the storage follows the VAULT
      // (server-paths.ts::sessionPartition) instead of the port number.
      partition,
    },
  });

  // The user-activation clock for page-initiated external opens. Electron
  // exposes no activation flag on the navigation or window-open paths, so the
  // shell measures it here (origin-pin.ts says why).
  window.webContents.on("input-event", () => {
    lastInputAt = Date.now();
  });

  window.webContents.setWindowOpenHandler((details) => {
    if (classifyWindowOpen(details.url) === "deny-and-open-external") {
      openExternalFromPage(details.url);
    }
    return { action: "deny" };
  });

  const guardNavigation = (event: Electron.Event, url: string): void => {
    const verdict = classifyNavigation(url, target.origin);
    if (verdict === "allow") {
      return;
    }
    event.preventDefault();
    if (verdict === "block-and-open-external") {
      openExternalFromPage(url);
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

  void window.loadURL(windowUrl(target.origin));
  return window;
}

function showMainWindow(target: ServerTarget): BrowserWindow {
  const existing = mainWindow;
  if (existing === null) {
    mainWindow = createWindow(target);
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

/** The data dir is the shell's OWN resolution (`resolveServerTarget`), never a
 *  value read back off the wire — a responder does not get to say where a menu
 *  item opens a Finder window. */
function openDataDir(target: ServerTarget): void {
  void shell.openPath(target.dataDir);
}

function configureApplicationMenu(target: ServerTarget): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { label: "Open Data Folder", click: () => openDataDir(target) },
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
          // A menu click IS the user gesture, so this goes straight out rather
          // than through the page-initiated activation gate.
          click: () => {
            void shell.openExternal(windowUrl(target.origin));
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** Tray icon, sized and marked as a template so macOS tints it for the menu
 *  bar rather than rendering the full-colour app icon. */
function createTray(target: ServerTarget): Tray | null {
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
      { label: `Show ${APP_DISPLAY_NAME}`, click: () => showMainWindow(target) },
      { label: "Hide", click: () => mainWindow?.hide() },
      { type: "separator" },
      { label: "Open Data Folder", click: () => openDataDir(target) },
      { type: "separator" },
      { role: "quit" },
    ]),
  );
  created.on("click", () => showMainWindow(target));
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
  configureApplicationMenu(target);
  await startServer(target);
  tray = createTray(target);
  mainWindow = createWindow(target);
}

// Resolved before `whenReady`, so a bad INTELIGIR_PORT or a config.json that
// nests the vault inside the data dir is a named error rather than a window on
// the wrong place.
const target = resolveServerTarget({
  isPackaged: app.isPackaged,
  appCheckoutDir: resolveAppCheckoutDir(app.getAppPath()),
  env: process.env,
});
if (target.kind === "refused") {
  dialog.showErrorBox("Inteligir failed to start", target.error);
  app.exit(2);
} else {
  const resolved = target.target;

  app.on("activate", () => {
    showMainWindow(resolved);
  });

  // The server is a child of this process, so quitting must take it with it —
  // and the SIGTERM its graceful shutdown listens for is what flushes the
  // vault's pending commit. `before-quit` is where that still has time to run.
  // `supervisor` is null when the shell ADOPTED a server it did not start;
  // quitting must leave that one running.
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
      showMainWindow(resolved);
    });
    app
      .whenReady()
      .then(() => onAppReady(resolved))
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
