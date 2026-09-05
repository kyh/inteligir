import { existsSync, realpathSync } from "node:fs";
import { z } from "zod";
import { dirname, join } from "node:path";
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
import { createSpellcheck, senderIsWindow, type Spellcheck } from "./spellcheck";
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
import {
  forgetVault,
  planVaultSwitch,
  readRecentVaults,
  rememberVault,
  switchBlockedBy,
  switchRefusalMessage,
  vaultRef,
  writeRecentVaults,
} from "./vaults";
import { writeManagedVaultDir } from "inteligir/server/config";
import { authorizationHeader } from "inteligir/server/server-file";
import {
  pathActionRequestSchema,
  type PathActionRequest,
  type PathActionResult,
} from "../path-action";
import { spellcheckChoiceSchema } from "../spellcheck-state";
import { IPC_CHANNELS, toErrorMessage } from "../types";
import { vaultPathSchema, type VaultsState } from "../vaults-state";

const APP_DISPLAY_NAME = app.isPackaged ? "Inteligir" : "Inteligir (Dev)";
const RECENT_VAULTS_FILE_NAME = "recent-vaults.json";

// set by `electron-vite dev`; absent in a packaged app.
const rendererDevUrl = process.env.ELECTRON_RENDERER_URL;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
// null when the shell adopted a server it did not start; quitting must leave that one running.
let serverProcess: ServerProcess | null = null;
let lastInputAt: number | null = null;
let live: LiveServer | null = null;
let updates: Updates | null = null;
// the vault the window is on; a switch replaces it along with the child and the window
let currentTarget: ServerTarget | null = null;
let switching = false;
// the policy for the window session on the current vault; a switch builds a new one
let spellcheck: Spellcheck | null = null;
// the shell's own, never a vault's: a vault is a git repo that leaves this machine
let recentVaultsPath: string | null = null;
let recentVaults: string[] = [];

// must precede `app.whenReady`; Electron enforces the ordering.
registerAppScheme();

process.on("uncaughtException", (error) => {
  console.error("[desktop] uncaught exception:", error);
  dialog.showErrorBox("A JavaScript error occurred in the main process", toErrorMessage(error));
});

process.on("unhandledRejection", (reason) => {
  console.error("[desktop] unhandled rejection:", reason);
});

function requireTarget(): ServerTarget {
  if (currentTarget === null) {
    throw new Error("no vault is open yet");
  }
  return currentTarget;
}

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
    serverProcess = null;
    return;
  }
  const entryPath = serverEntryPath(app.getAppPath());
  if (!existsSync(entryPath)) {
    throw new Error(`the bundled server is missing (${entryPath}) — this install is incomplete`);
  }
  const child = createServerProcess({
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
  serverProcess = child;
  await child.start();
}

// the child's ordered shutdown flushes the vault's pending commit; nothing moves until it has
async function stopOwnedServer(): Promise<void> {
  const owned = serverProcess;
  serverProcess = null;
  live = null;
  await owned?.stop();
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
// a session revisited on a later switch gets the new bearer: the listener replaces the last.
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
function spellcheckFor(windowSession: Electron.Session): Spellcheck {
  return createSpellcheck({
    platform: process.platform,
    port: {
      availableLanguages: () => windowSession.availableSpellCheckerLanguages,
      isEnabled: () => windowSession.isSpellCheckerEnabled(),
      languages: () => windowSession.getSpellCheckerLanguages(),
      setEnabled: (enabled) => windowSession.setSpellCheckerEnabled(enabled),
      setLanguages: (languages) => windowSession.setSpellCheckerLanguages([...languages]),
    },
  });
}

// the page names an entry vault-relative; main resolves it against the vault of the moment
// and hands the OS nothing the vault does not physically contain. registered once per
// launch: a second `handle` on a channel throws, so the handlers read the current vault
function configurePathActionsIpc(): void {
  const resolve = (request: PathActionRequest) =>
    resolveVaultEntry({
      vaultDir: requireTarget().vaultDir,
      path: request.path,
      realpath: realpathSync,
    });
  handleFromMainWindow(
    IPC_CHANNELS.REVEAL_PATH,
    pathActionRequestSchema,
    (frame): PathActionResult => {
      const verdict = resolve(frame);
      if (!verdict.ok) return verdict;
      shell.showItemInFolder(verdict.absPath);
      return { ok: true };
    },
  );
  handleFromMainWindow(
    IPC_CHANNELS.OPEN_PATH,
    pathActionRequestSchema,
    async (frame): Promise<PathActionResult> => {
      const verdict = resolve(frame);
      if (!verdict.ok) return verdict;
      // answers "" when the OS took the file, else its own words for why not
      const refusal = await shell.openPath(verdict.absPath);
      return refusal === "" ? { ok: true } : { ok: false, reason: refusal };
    },
  );
}

// once per vault, not per window: the partition is the data dir's, so a switch is a new session
// and a vault revisited in one launch re-registers on its old one.
function prepareWindowSession(target: ServerTarget, server: LiveServer): void {
  const windowSession = lockDownSession(sessionPartition(target.dataDir));
  attachSocketCredential(windowSession, server);
  spellcheck = spellcheckFor(windowSession);
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

function showMainWindow(): BrowserWindow {
  const existing = mainWindow;
  if (existing === null) {
    mainWindow = createWindow(requireTarget());
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
  void shell.openPath(requireTarget().dataDir);
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

// every page-facing channel refuses a stranger's webContents before it reads a frame, and
// the frame is parsed here, at the boundary, so a handler only ever sees a value it knows
function handleFromMainWindow<TFrame, TAnswer>(
  channel: string,
  frameSchema: z.ZodType<TFrame>,
  handler: (frame: TFrame) => TAnswer | Promise<TAnswer>,
): void {
  ipcMain.handle(channel, (event, frame) => {
    if (!fromMainWindow(event)) throw new Error("refused");
    return handler(frameSchema.parse(frame));
  });
}

// a channel carrying no frame
const noFrame = z.undefined();

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
  handleFromMainWindow(IPC_CHANNELS.UPDATE_GET_STATE, noFrame, () => {
    return created.state();
  });
  handleFromMainWindow(IPC_CHANNELS.UPDATE_CHECK, noFrame, () => {
    return created.check("settings");
  });
  handleFromMainWindow(IPC_CHANNELS.UPDATE_DOWNLOAD, noFrame, () => {
    return created.download();
  });
  handleFromMainWindow(IPC_CHANNELS.UPDATE_INSTALL, noFrame, async () => {
    await installUpdate();
    return created.state();
  });
  return created;
}

function requireSpellcheck(): Spellcheck {
  if (spellcheck === null) {
    throw new Error("no window session yet");
  }
  return spellcheck;
}

// registered once per launch: a second `handle` on a channel throws, so every handler reads
// the vault of the moment rather than closing over the first one
function configureSpellcheckIpc(): void {
  handleFromMainWindow(IPC_CHANNELS.SPELLCHECK_GET_STATE, noFrame, () => {
    return requireSpellcheck().state();
  });
  // the frame is parsed here, at the boundary: the page's choice reaches the session typed or not at all
  handleFromMainWindow(IPC_CHANNELS.SPELLCHECK_APPLY, spellcheckChoiceSchema, (frame) => {
    return requireSpellcheck().apply(frame);
  });
}

function vaultsState(): VaultsState {
  const target = requireTarget();
  const blocked = switchBlockedBy({ ownsServer: serverProcess !== null, current: target });
  return {
    current: vaultRef(target.vaultDir),
    // a folder that is gone (an unmounted drive) stays remembered and stays off the list
    recent: recentVaults
      .filter((path) => path !== target.vaultDir && existsSync(path))
      .map(vaultRef),
    blocked: blocked === null ? null : switchRefusalMessage(blocked),
  };
}

function setRecentVaults(next: string[]): void {
  recentVaults = next;
  if (recentVaultsPath !== null) {
    try {
      writeRecentVaults(recentVaultsPath, next);
    } catch (cause) {
      console.warn("[desktop] could not write the recent-vaults list", cause);
    }
  }
  configureApplicationMenu();
}

function rememberCurrentVault(): void {
  setRecentVaults(rememberVault(recentVaults, requireTarget().vaultDir));
}

// the server first, then the session it answers on, then the window that loads from it
async function bootVault(target: ServerTarget): Promise<void> {
  currentTarget = target;
  await startServer(target);
  // everything below names the origin the server answered on, which an adopted one chose.
  const server = live;
  if (server === null) {
    throw new Error("the server reported ready without publishing its address");
  }
  prepareWindowSession(target, server);
  rememberCurrentVault();
  mainWindow = createWindow(target);
}

async function switchVault(vaultDir: string): Promise<void> {
  const previous = requireTarget();
  const plan = planVaultSwitch({ ownsServer: serverProcess !== null, current: previous }, vaultDir);
  if (plan.kind === "refused") {
    throw new Error(switchRefusalMessage(plan.reason));
  }
  // resolved and refused exactly as a boot would, before anything moves
  const candidate = resolveServerTarget({ isPackaged: app.isPackaged, env: process.env, vaultDir });
  if (candidate.kind === "refused") {
    throw new Error(candidate.error);
  }
  if (switching) {
    throw new Error("Another vault is already opening.");
  }
  switching = true;
  const previousWindow = mainWindow;
  try {
    await stopOwnedServer();
    writeManagedVaultDir(previous.rootDataDir, candidate.target.vaultDir);
    // re-read rather than reused: the child boots on what config.json now says, as the CLI would
    const next = resolveServerTarget({ isPackaged: app.isPackaged, env: process.env });
    if (next.kind === "refused") {
      throw new Error(next.error);
    }
    try {
      await bootVault(next.target);
    } catch (cause) {
      console.error("[desktop] the vault did not open; returning to the previous one", cause);
      writeManagedVaultDir(previous.rootDataDir, previous.vaultDir);
      await stopOwnedServer();
      try {
        await bootVault(previous);
      } catch (again) {
        dialog.showErrorBox(
          "Inteligir could not reopen the vault",
          `${toErrorMessage(again)} Reopen Inteligir to continue.`,
        );
        app.quit();
        throw again;
      }
      previousWindow?.close();
      throw new Error(`Could not open ${candidate.target.vaultDir}: ${toErrorMessage(cause)}`, {
        cause,
      });
    }
  } finally {
    switching = false;
  }
  previousWindow?.close();
}

// the folder is the user's pick, made in main: the page never names a path it was not handed
async function pickVaultDir(): Promise<string | null> {
  const options: Electron.OpenDialogOptions = {
    title: "Open vault",
    buttonLabel: "Open vault",
    properties: ["openDirectory", "createDirectory"],
    defaultPath: dirname(requireTarget().vaultDir),
  };
  const picked =
    mainWindow === null
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(mainWindow, options);
  if (picked.canceled) {
    return null;
  }
  return picked.filePaths[0] ?? null;
}

async function switchVaultFromMenu(vaultDir: string): Promise<void> {
  try {
    await switchVault(vaultDir);
  } catch (cause) {
    dialog.showErrorBox("Could not open the vault", toErrorMessage(cause));
  }
}

async function pickAndSwitchFromMenu(): Promise<void> {
  const picked = await pickVaultDir();
  if (picked !== null) {
    await switchVaultFromMenu(picked);
  }
}

function configureVaultsIpc(): void {
  handleFromMainWindow(IPC_CHANNELS.VAULTS_GET_STATE, noFrame, () => {
    return vaultsState();
  });
  handleFromMainWindow(IPC_CHANNELS.VAULTS_PICK, noFrame, async () => {
    const picked = await pickVaultDir();
    if (picked !== null) {
      await switchVault(picked);
    }
    return vaultsState();
  });
  // only a path this process handed out comes back: the list is the page's whole vocabulary
  handleFromMainWindow(IPC_CHANNELS.VAULTS_OPEN, vaultPathSchema, async (path) => {
    if (!recentVaults.includes(path)) {
      throw new Error("That vault is not one the app remembers.");
    }
    await switchVault(path);
    return vaultsState();
  });
  handleFromMainWindow(IPC_CHANNELS.VAULTS_FORGET, vaultPathSchema, (frame) => {
    setRecentVaults(forgetVault(recentVaults, frame));
    return vaultsState();
  });
}

function configureApplicationMenu(): void {
  const current = currentTarget?.vaultDir ?? null;
  const recentItems: MenuItemConstructorOptions[] = recentVaults
    .filter((path) => path !== current)
    .map((path) => ({
      label: vaultRef(path).name,
      sublabel: path,
      click: () => {
        void switchVaultFromMenu(path);
      },
    }));
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
    {
      label: "File",
      submenu: [
        {
          label: "Open Vault…",
          click: () => {
            void pickAndSwitchFromMenu();
          },
        },
        {
          label: "Open Recent Vault",
          enabled: recentItems.length > 0,
          submenu: recentItems,
        },
        { type: "separator" },
        { role: "close" },
      ],
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
            if (live !== null) {
              void shell.openExternal(`${live.origin}/`);
            }
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createTray(): Tray | null {
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
      { label: `Show ${APP_DISPLAY_NAME}`, click: () => showMainWindow() },
      { label: "Hide", click: () => mainWindow?.hide() },
      { type: "separator" },
      { label: "Open Data Folder", click: () => openDataDir() },
      { type: "separator" },
      { role: "quit" },
    ]),
  );
  created.on("click", () => showMainWindow());
  return created;
}

async function onAppReady(target: ServerTarget): Promise<void> {
  app.setName(APP_DISPLAY_NAME);
  app.setAboutPanelOptions({
    applicationName: APP_DISPLAY_NAME,
    applicationVersion: app.getVersion(),
  });
  recentVaultsPath = join(app.getPath("userData"), RECENT_VAULTS_FILE_NAME);
  recentVaults = readRecentVaults(recentVaultsPath, (message) =>
    console.warn(`[desktop] ${message}`),
  );
  ipcMain.on(IPC_CHANNELS.SOCKET_ORIGIN, (event) => {
    event.returnValue = live?.origin ?? "";
  });
  configureSpellcheckIpc();
  configureVaultsIpc();
  configurePathActionsIpc();
  configureApplicationMenu();
  tray = createTray();
  updates = configureUpdates();
  await bootVault(target);
  updates.start();
}

const target = resolveServerTarget({ isPackaged: app.isPackaged, env: process.env });
if (target.kind === "refused") {
  dialog.showErrorBox("Inteligir failed to start", target.error);
  app.exit(2);
} else {
  app.on("activate", () => {
    if (live !== null) {
      showMainWindow();
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
        showMainWindow();
      }
    });
    app
      .whenReady()
      .then(() => onAppReady(target.target))
      .catch((cause: unknown) => {
        console.error("[desktop] fatal startup error", cause);
        dialog.showErrorBox("Inteligir failed to start", toErrorMessage(cause));
        app.quit();
      });
  }
}
