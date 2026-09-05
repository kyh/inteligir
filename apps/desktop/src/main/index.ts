import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { autoUpdater } from "electron-updater";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  session,
  shell,
  Tray,
  type MenuItemConstructorOptions,
} from "electron";
import { rendererDir, appPreloadScript } from "./bundle-paths";
import { socketCredentialFilter } from "./credential-scope";
import {
  appWindowWebPreferences,
  classifyNavigation,
  classifyPermission,
  classifyWindowOpen,
  decideExternalOpen,
} from "./origin-pin";
import { APP_ORIGIN, registerAppProtocol, registerAppScheme } from "./protocol";
import { createServerProcess, type ServerProcess } from "./server-process";
import { createSpellcheck, senderIsWindow } from "./spellcheck";
import { createUpdates, type UpdaterPort, type Updates } from "./updates";
import { resolveVaultEntry } from "./vault-entry";
import {
  describeServerVerdict,
  planServerStart,
  resolveServerTarget,
  serverEntryPath,
  serverProcessEnv,
  sessionPartition,
  verifyServer,
  type LiveServer,
  type ServerTarget,
} from "./server-instance";
import { authorizationHeader } from "inteligir/server/server-file";
import {
  pathActionRequestSchema,
  type PathActionRequest,
  type PathActionResult,
} from "../path-action";
import { spellcheckChoiceSchema } from "../spellcheck-state";
import { IPC_CHANNELS, toErrorMessage } from "../types";

const APP_DISPLAY_NAME = app.isPackaged ? "Inteligir" : "Inteligir (Dev)";

// set by `electron-vite dev`; absent in a packaged app.
const rendererDevUrl = process.env.ELECTRON_RENDERER_URL;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
// null when the shell adopted a server it did not start; quitting must leave that one running.
let serverProcess: ServerProcess | null = null;
let lastInputAt: number | null = null;
let live: LiveServer | null = null;
let updates: Updates | null = null;

// must precede `app.whenReady`; Electron enforces the ordering.
registerAppScheme();

process.on("uncaughtException", (error) => {
  console.error("[desktop] uncaught exception:", error);
  dialog.showErrorBox("A JavaScript error occurred in the main process", toErrorMessage(error));
});

process.on("unhandledRejection", (reason) => {
  console.error("[desktop] unhandled rejection:", reason);
});

// doubles as the child's readiness signal: a child that lost the port race must not be reported up about a stranger.
async function verifiedServerAnswered(target: ServerTarget): Promise<boolean> {
  const verdict = await verifyServer(target.dataDir);
  if (verdict.kind === "verified") {
    live = verdict.live;
    return true;
  }
  if (verdict.kind !== "no-server") {
    console.warn(`[desktop] ${describeServerVerdict(verdict, target.dataDir)}`);
  }
  return false;
}

async function startServer(target: ServerTarget): Promise<void> {
  if (planServerStart(await verifiedServerAnswered(target)) === "adopt") {
    console.log(`[desktop] adopting the server already serving ${target.dataDir}`);
    return;
  }
  const entryPath = serverEntryPath(app.getAppPath());
  if (!existsSync(entryPath)) {
    throw new Error(`the bundled server is missing (${entryPath}) — this install is incomplete`);
  }
  serverProcess = createServerProcess({
    entryPath,
    env: serverProcessEnv(target, app.isPackaged),
    isReady: () => verifiedServerAnswered(target),
    log: (message) => console.log(`[server] ${message}`),
    // no in-place restart: a fresh child mints a fresh token the window's bindings do not hold.
    onUnexpectedExit: (code) => {
      dialog.showErrorBox(
        "Inteligir server stopped",
        `The local server exited unexpectedly (code ${String(code)}). Reopen Inteligir to continue.`,
      );
      app.quit();
    },
  });
  await serverProcess.start();
}

// both handlers are needed: the request handler answers a prompt, the check handler
// answers `navigator.permissions.query` and `getUserMedia`'s pre-flight.
function lockDownSession(partition: string): Electron.Session {
  const windowSession = session.fromPartition(partition);
  windowSession.setPermissionRequestHandler((_contents, permission, callback, details) => {
    callback(classifyPermission(permission, details.requestingUrl, APP_ORIGIN));
  });
  windowSession.setPermissionCheckHandler((_contents, permission, requestingOrigin) =>
    classifyPermission(permission, requestingOrigin, APP_ORIGIN),
  );
  // device pickers are not covered by the permission handlers.
  windowSession.setDevicePermissionHandler(() => false);
  return windowSession;
}

// a browser `WebSocket` cannot set a header and cannot be proxied by the protocol handler.
function attachSocketCredential(windowSession: Electron.Session, server: LiveServer): void {
  const urls = socketCredentialFilter(server.origin);
  windowSession.webRequest.onBeforeSendHeaders({ urls }, (details, callback) => {
    callback({
      requestHeaders: {
        ...details.requestHeaders,
        Authorization: authorizationHeader(server.token),
      },
    });
  });
}

// page-initiated only; menu and tray items call `shell.openExternal` directly, since a click produces no page input.
function openExternalFromPage(url: string): void {
  const decision = decideExternalOpen({ url, lastInputAt, now: Date.now() });
  if (!decision.allowed) {
    console.warn(`[desktop] refused to open ${url} externally (${decision.reason})`);
    return;
  }
  void shell.openExternal(url);
}

// the page keeps the choice and re-applies it on launch; Chromium keeps the session's own copy between launches
function configureSpellcheck(windowSession: Electron.Session): void {
  const created = createSpellcheck({
    platform: process.platform,
    port: {
      availableLanguages: () => windowSession.availableSpellCheckerLanguages,
      isEnabled: () => windowSession.isSpellCheckerEnabled(),
      languages: () => windowSession.getSpellCheckerLanguages(),
      setEnabled: (enabled) => windowSession.setSpellCheckerEnabled(enabled),
      setLanguages: (languages) => windowSession.setSpellCheckerLanguages([...languages]),
    },
  });
  ipcMain.handle(IPC_CHANNELS.SPELLCHECK_GET_STATE, (event) => {
    if (!fromMainWindow(event)) throw new Error("refused");
    return created.state();
  });
  // the frame is parsed here, at the boundary: the page's choice reaches the session typed or not at all
  ipcMain.handle(IPC_CHANNELS.SPELLCHECK_APPLY, (event, frame) => {
    if (!fromMainWindow(event)) throw new Error("refused");
    return created.apply(spellcheckChoiceSchema.parse(frame));
  });
}

// the page names an entry vault-relative; main resolves it against the vault it launched
// with and hands the OS nothing the vault does not physically contain
function configurePathActions(target: ServerTarget): void {
  const resolve = (request: PathActionRequest) =>
    resolveVaultEntry({ vaultDir: target.vaultDir, path: request.path, realpath: realpathSync });
  ipcMain.handle(IPC_CHANNELS.REVEAL_PATH, (event, frame): PathActionResult => {
    if (!fromMainWindow(event)) throw new Error("refused");
    const verdict = resolve(pathActionRequestSchema.parse(frame));
    if (!verdict.ok) return verdict;
    shell.showItemInFolder(verdict.absPath);
    return { ok: true };
  });
  ipcMain.handle(IPC_CHANNELS.OPEN_PATH, async (event, frame): Promise<PathActionResult> => {
    if (!fromMainWindow(event)) throw new Error("refused");
    const verdict = resolve(pathActionRequestSchema.parse(frame));
    if (!verdict.ok) return verdict;
    // answers "" when the OS took the file, else its own words for why not
    const refusal = await shell.openPath(verdict.absPath);
    return refusal === "" ? { ok: true } : { ok: false, reason: refusal };
  });
}

// once per launch, not per window: `protocol.handle` throws if the scheme is handled twice on one session.
function prepareWindowSession(target: ServerTarget, server: LiveServer): void {
  const windowSession = lockDownSession(sessionPartition(target.dataDir));
  attachSocketCredential(windowSession, server);
  configureSpellcheck(windowSession);
  registerAppProtocol({
    session: windowSession,
    serverOrigin: server.origin,
    token: server.token,
    renderer:
      rendererDevUrl === undefined
        ? { kind: "files", dir: rendererDir() }
        : { kind: "dev", origin: rendererDevUrl },
  });
}

function createWindow(target: ServerTarget): BrowserWindow {
  const partition = sessionPartition(target.dataDir);
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
    webPreferences: appWindowWebPreferences(appPreloadScript(), partition),
  });

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
    const verdict = classifyNavigation(url, APP_ORIGIN);
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

  void window.loadURL(`${APP_ORIGIN}/`);
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

function openDataDir(target: ServerTarget): void {
  void shell.openPath(target.dataDir);
}

// electron-builder writes the feed beside the app; without it a check can only fail.
function updateFeedDisabledReason(): string | null {
  if (!app.isPackaged) {
    return "Automatic updates are only available in the packaged app.";
  }
  if (!existsSync(join(process.resourcesPath, "app-update.yml"))) {
    return "This build carries no update feed.";
  }
  return null;
}

function fromMainWindow(event: Electron.IpcMainInvokeEvent): boolean {
  return senderIsWindow(event.sender, mainWindow);
}

async function askToRestart(version: string): Promise<void> {
  const { response } = await dialog.showMessageBox({
    type: "info",
    title: "Update ready",
    message: `Inteligir ${version} is ready to install.`,
    detail: "The app restarts to finish. Your notes are saved first.",
    buttons: ["Restart now", "Later"],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) {
    await installUpdate();
  }
}

function logUpdater(message: string): void {
  console.log(`[updater] ${message}`);
}

// the server is already down when this fails, so the honest move is to say so and quit
async function installUpdate(): Promise<void> {
  if (updates === null) return;
  const outcome = await updates.install();
  if (outcome.kind === "failed") {
    dialog.showErrorBox(
      "Update failed",
      `${outcome.state.message ?? "The installer refused."} Reopen Inteligir to continue.`,
    );
    app.quit();
  }
}

async function checkForUpdatesFromMenu(): Promise<void> {
  if (updates === null) return;
  const state = await updates.check("menu");
  switch (state.status) {
    case "up-to-date":
      await dialog.showMessageBox({
        type: "info",
        title: "You're up to date",
        message: `Inteligir ${state.currentVersion} is the newest version.`,
        buttons: ["OK"],
      });
      return;
    case "available": {
      const { response } = await dialog.showMessageBox({
        type: "info",
        title: "Update available",
        message: `Inteligir ${state.availableVersion ?? ""} is available.`,
        buttons: ["Download", "Later"],
        defaultId: 0,
        cancelId: 1,
      });
      if (response !== 0) return;
      const downloaded = await updates.download();
      if (downloaded.status === "downloaded" && downloaded.downloadedVersion !== null) {
        await askToRestart(downloaded.downloadedVersion);
      } else if (downloaded.status === "error") {
        dialog.showErrorBox(
          "Download failed",
          downloaded.message ?? "The download did not finish.",
        );
      }
      return;
    }
    case "downloaded":
      await askToRestart(state.downloadedVersion ?? "");
      return;
    case "disabled":
    case "error":
      await dialog.showMessageBox({
        type: "warning",
        title: state.status === "disabled" ? "Updates are off" : "Update check failed",
        message: state.message ?? "Could not check for updates.",
        buttons: ["OK"],
      });
      return;
    case "idle":
    case "checking":
    case "downloading":
      return;
  }
}

function electronUpdaterPort(): UpdaterPort {
  return {
    disarmAutomation() {
      autoUpdater.autoDownload = false;
      autoUpdater.autoInstallOnAppQuit = false;
    },
    checkForUpdates: () => autoUpdater.checkForUpdates(),
    downloadUpdate: () => autoUpdater.downloadUpdate(),
    quitAndInstall(isSilent, isForceRunAfter) {
      autoUpdater.quitAndInstall(isSilent, isForceRunAfter);
    },
    subscribe(handlers) {
      autoUpdater.on("update-available", handlers.updateAvailable);
      autoUpdater.on("update-not-available", handlers.updateNotAvailable);
      autoUpdater.on("download-progress", handlers.downloadProgress);
      autoUpdater.on("update-downloaded", handlers.updateDownloaded);
      autoUpdater.on("error", handlers.error);
    },
  };
}

function configureUpdates(): Updates {
  autoUpdater.logger = {
    info: (message?: string) => logUpdater(message ?? ""),
    warn: (message?: string) => logUpdater(`warn: ${message ?? ""}`),
    error: (message?: string) => logUpdater(`error: ${message ?? ""}`),
  };
  const created = createUpdates({
    updater: electronUpdaterPort(),
    currentVersion: app.getVersion(),
    disabledReason: updateFeedDisabledReason(),
    // an adopted server is nobody's to stop and outlives the shell
    stopServer: async () => {
      await serverProcess?.stop();
    },
    broadcast: (state) => {
      mainWindow?.webContents.send(IPC_CHANNELS.UPDATE_STATE, state);
    },
    log: logUpdater,
  });
  ipcMain.handle(IPC_CHANNELS.UPDATE_GET_STATE, (event) => {
    if (!fromMainWindow(event)) throw new Error("refused");
    return created.state();
  });
  ipcMain.handle(IPC_CHANNELS.UPDATE_CHECK, (event) => {
    if (!fromMainWindow(event)) throw new Error("refused");
    return created.check("settings");
  });
  ipcMain.handle(IPC_CHANNELS.UPDATE_DOWNLOAD, (event) => {
    if (!fromMainWindow(event)) throw new Error("refused");
    return created.download();
  });
  ipcMain.handle(IPC_CHANNELS.UPDATE_INSTALL, async (event) => {
    if (!fromMainWindow(event)) throw new Error("refused");
    await installUpdate();
    return created.state();
  });
  return created;
}

function configureApplicationMenu(target: ServerTarget, server: LiveServer): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        {
          label: "Check for Updates…",
          click: () => {
            void checkForUpdatesFromMenu();
          },
        },
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
    {
      label: "File",
      submenu: [{ role: "close" }],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        {
          label: "Open in Browser",
          click: () => {
            void shell.openExternal(`${server.origin}/`);
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

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

async function onAppReady(target: ServerTarget): Promise<void> {
  app.setName(APP_DISPLAY_NAME);
  app.setAboutPanelOptions({
    applicationName: APP_DISPLAY_NAME,
    applicationVersion: app.getVersion(),
  });
  await startServer(target);
  // everything below names the origin the server answered on, which an adopted one chose.
  const server = live;
  if (server === null) {
    throw new Error("the server reported ready without publishing its address");
  }
  prepareWindowSession(target, server);
  configurePathActions(target);
  ipcMain.on(IPC_CHANNELS.SOCKET_ORIGIN, (event) => {
    event.returnValue = server.origin;
  });
  configureApplicationMenu(target, server);
  tray = createTray(target);
  updates = configureUpdates();
  mainWindow = createWindow(target);
  updates.start();
}

const target = resolveServerTarget({ isPackaged: app.isPackaged, env: process.env });
if (target.kind === "refused") {
  dialog.showErrorBox("Inteligir failed to start", target.error);
  app.exit(2);
} else {
  const resolved = target.target;

  app.on("activate", () => {
    if (live !== null) {
      showMainWindow(resolved);
    }
  });

  // empty on purpose: closing the last window hides to the tray; Electron's default handler would quit.
  app.on("window-all-closed", () => {});

  // the child's SIGTERM teardown flushes the vault's pending commit; `before-quit` is where it still has time to run.
  let teardown: Promise<void> | null = null;
  app.on("before-quit", (event) => {
    if (serverProcess === null || teardown !== null) {
      return;
    }
    event.preventDefault();
    teardown = serverProcess.stop().finally(() => {
      tray?.destroy();
      tray = null;
      app.quit();
    });
  });

  // two shells would race for the port and the loser would adopt the winner's server.
  if (!app.requestSingleInstanceLock()) {
    app.quit();
  } else {
    app.on("second-instance", () => {
      if (live !== null) {
        showMainWindow(resolved);
      }
    });
    app
      .whenReady()
      .then(() => onAppReady(resolved))
      .catch((cause: unknown) => {
        console.error("[desktop] fatal startup error", cause);
        dialog.showErrorBox("Inteligir failed to start", toErrorMessage(cause));
        app.quit();
      });
  }
}
