import { existsSync, realpathSync } from "node:fs";
import { z } from "zod";
import path from "node:path";
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
} from "electron";
import type { MenuItemConstructorOptions } from "electron";
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
import { createServerProcess } from "./server-process";
import type { ServerProcess } from "./server-process";
import { createSpellcheck, senderIsWindow } from "./spellcheck";
import type { Spellcheck } from "./spellcheck";
import { createUpdates } from "./updates";
import type { UpdaterPort, Updates } from "./updates";
import { resolveVaultEntry } from "./vault-entry";
import {
  describeServerVerdict,
  planServerStart,
  resolveServerTarget,
  serverEntryPath,
  serverProcessEnv,
  sessionPartition,
  verifyServer,
} from "./server-instance";
import type { LiveServer, ServerTarget } from "./server-instance";
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
import { pathActionRequestSchema } from "../path-action";
import type { PathActionRequest, PathActionResult } from "../path-action";
import { spellcheckChoiceSchema } from "../spellcheck-state";
import { IPC_CHANNELS, toErrorMessage } from "../types";
import { vaultPathSchema } from "../vaults-state";
import type { VaultsState } from "../vaults-state";

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

const requireTarget = (): ServerTarget => {
  if (currentTarget === null) {
    throw new Error("no vault is open yet");
  }
  return currentTarget;
};

// doubles as the child's readiness signal: a child that lost the port race must not be reported up about a stranger.
const verifiedServerAnswered = async (target: ServerTarget): Promise<boolean> => {
  const verdict = await verifyServer(target.dataDir);
  if (verdict.kind === "verified") {
    ({ live } = verdict);
    return true;
  }
  if (verdict.kind !== "no-server") {
    console.warn(`[desktop] ${describeServerVerdict(verdict, target.dataDir)}`);
  }
  return false;
};

const startServer = async (target: ServerTarget): Promise<void> => {
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
    isReady: async () => await verifiedServerAnswered(target),
    log: (message) => {
      console.log(`[server] ${message}`);
    },
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
};

// the child's ordered shutdown flushes the vault's pending commit; nothing moves until it has
const stopOwnedServer = async (): Promise<void> => {
  const owned = serverProcess;
  serverProcess = null;
  live = null;
  await owned?.stop();
};

// both handlers are needed: the request handler answers a prompt, the check handler
// answers `navigator.permissions.query` and `getUserMedia`'s pre-flight.
const lockDownSession = (partition: string): Electron.Session => {
  const windowSession = session.fromPartition(partition);
  windowSession.setPermissionRequestHandler((_contents, permission, respond, details) => {
    respond(classifyPermission(permission, details.requestingUrl, APP_ORIGIN));
  });
  windowSession.setPermissionCheckHandler((_contents, permission, requestingOrigin) =>
    classifyPermission(permission, requestingOrigin, APP_ORIGIN),
  );
  // device pickers are not covered by the permission handlers.
  windowSession.setDevicePermissionHandler(() => false);
  return windowSession;
};

// a browser `WebSocket` cannot set a header and cannot be proxied by the protocol handler.
// a session revisited on a later switch gets the new bearer: the listener replaces the last.
const attachSocketCredential = (windowSession: Electron.Session, server: LiveServer): void => {
  const urls = socketCredentialFilter(server.origin);
  windowSession.webRequest.onBeforeSendHeaders({ urls }, (details, respond) => {
    respond({
      requestHeaders: {
        ...details.requestHeaders,
        Authorization: authorizationHeader(server.token),
      },
    });
  });
};

// page-initiated only; menu and tray items call `shell.openExternal` directly, since a click produces no page input.
const openExternalFromPage = (url: string): void => {
  const decision = decideExternalOpen({ lastInputAt, now: Date.now(), url });
  if (!decision.allowed) {
    console.warn(`[desktop] refused to open ${url} externally (${decision.reason})`);
    return;
  }
  void shell.openExternal(url);
};

// the page keeps the choice and re-applies it on launch; Chromium keeps the session's own copy between launches
const spellcheckFor = (windowSession: Electron.Session): Spellcheck =>
  createSpellcheck({
    platform: process.platform,
    port: {
      availableLanguages: () => windowSession.availableSpellCheckerLanguages,
      isEnabled: () => windowSession.isSpellCheckerEnabled(),
      languages: () => windowSession.getSpellCheckerLanguages(),
      setEnabled: (enabled) => {
        windowSession.setSpellCheckerEnabled(enabled);
      },
      setLanguages: (languages) => {
        windowSession.setSpellCheckerLanguages([...languages]);
      },
    },
  });

// once per vault, not per window: the partition is the data dir's, so a switch is a new session
// and a vault revisited in one launch re-registers on its old one.
const prepareWindowSession = (target: ServerTarget, server: LiveServer): void => {
  const windowSession = lockDownSession(sessionPartition(target.dataDir));
  attachSocketCredential(windowSession, server);
  spellcheck = spellcheckFor(windowSession);
  registerAppProtocol({
    renderer:
      rendererDevUrl === undefined
        ? { dir: rendererDir(), kind: "files" }
        : { kind: "dev", origin: rendererDevUrl },
    serverOrigin: server.origin,
    session: windowSession,
    token: server.token,
  });
};

const createWindow = (target: ServerTarget): BrowserWindow => {
  const partition = sessionPartition(target.dataDir);
  const window = new BrowserWindow({
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#141415" : "#f0f2f2",
    height: 800,
    minHeight: 600,
    minWidth: 800,
    show: false,
    title: APP_DISPLAY_NAME,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 12 },
    webPreferences: appWindowWebPreferences(appPreloadScript(), partition),
    width: 1200,
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
};

const showMainWindow = (): BrowserWindow => {
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
};

const openDataDir = (): void => {
  void shell.openPath(requireTarget().dataDir);
};

// electron-builder writes the feed beside the app; without it a check can only fail.
const updateFeedDisabledReason = (): string | null => {
  if (!app.isPackaged) {
    return "Automatic updates are only available in the packaged app.";
  }
  if (!existsSync(path.join(process.resourcesPath, "app-update.yml"))) {
    return "This build carries no update feed.";
  }
  return null;
};

const fromMainWindow = (event: Electron.IpcMainInvokeEvent): boolean =>
  senderIsWindow(event.sender, mainWindow);

// every page-facing channel refuses a stranger's webContents before it reads a frame, and
// the frame is parsed here, at the boundary, so a handler only ever sees a value it knows
const handleFromMainWindow = <TFrame, TAnswer>(
  channel: string,
  frameSchema: z.ZodType<TFrame>,
  handler: (frame: TFrame) => TAnswer | Promise<TAnswer>,
): void => {
  ipcMain.handle(channel, async (event, frame) => {
    if (!fromMainWindow(event)) {
      throw new Error("refused");
    }
    return await handler(frameSchema.parse(frame));
  });
};

// a channel carrying no frame
const noFrame = z.undefined();

// the page names an entry vault-relative; main resolves it against the vault of the moment
// and hands the OS nothing the vault does not physically contain. registered once per
// launch: a second `handle` on a channel throws, so the handlers read the current vault
const configurePathActionsIpc = (): void => {
  const resolve = (request: PathActionRequest) =>
    resolveVaultEntry({
      path: request.path,
      realpath: realpathSync,
      vaultDir: requireTarget().vaultDir,
    });
  handleFromMainWindow(
    IPC_CHANNELS.REVEAL_PATH,
    pathActionRequestSchema,
    (frame): PathActionResult => {
      const verdict = resolve(frame);
      if (!verdict.ok) {
        return verdict;
      }
      shell.showItemInFolder(verdict.absPath);
      return { ok: true };
    },
  );
  handleFromMainWindow(
    IPC_CHANNELS.OPEN_PATH,
    pathActionRequestSchema,
    async (frame): Promise<PathActionResult> => {
      const verdict = resolve(frame);
      if (!verdict.ok) {
        return verdict;
      }
      // answers "" when the OS took the file, else its own words for why not
      const refusal = await shell.openPath(verdict.absPath);
      return refusal === "" ? { ok: true } : { ok: false, reason: refusal };
    },
  );
};

// the server is already down when this fails, so the honest move is to say so and quit
const installUpdate = async (): Promise<void> => {
  if (updates === null) {
    return;
  }
  const outcome = await updates.install();
  if (outcome.kind === "failed") {
    dialog.showErrorBox(
      "Update failed",
      `${outcome.state.message ?? "The installer refused."} Reopen Inteligir to continue.`,
    );
    app.quit();
  }
};

const askToRestart = async (version: string): Promise<void> => {
  const { response } = await dialog.showMessageBox({
    buttons: ["Restart now", "Later"],
    cancelId: 1,
    defaultId: 0,
    detail: "The app restarts to finish. Your notes are saved first.",
    message: `Inteligir ${version} is ready to install.`,
    title: "Update ready",
    type: "info",
  });
  if (response === 0) {
    await installUpdate();
  }
};

const logUpdater = (message: string): void => {
  console.log(`[updater] ${message}`);
};

const checkForUpdatesFromMenu = async (): Promise<void> => {
  if (updates === null) {
    return;
  }
  const state = await updates.check("menu");
  switch (state.status) {
    case "idle":
    case "checking":
    case "downloading": {
      return;
    }
    case "up-to-date": {
      await dialog.showMessageBox({
        buttons: ["OK"],
        message: `Inteligir ${state.currentVersion} is the newest version.`,
        title: "You're up to date",
        type: "info",
      });
      return;
    }
    case "available": {
      const { response } = await dialog.showMessageBox({
        buttons: ["Download", "Later"],
        cancelId: 1,
        defaultId: 0,
        message: `Inteligir ${state.availableVersion ?? ""} is available.`,
        title: "Update available",
        type: "info",
      });
      if (response !== 0) {
        return;
      }
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
    case "downloaded": {
      await askToRestart(state.downloadedVersion ?? "");
      return;
    }
    case "disabled":
    case "error": {
      await dialog.showMessageBox({
        buttons: ["OK"],
        message: state.message ?? "Could not check for updates.",
        title: state.status === "disabled" ? "Updates are off" : "Update check failed",
        type: "warning",
      });
      return;
    }
    default: {
      const exhaustive: never = state.status;
      return exhaustive;
    }
  }
};

const electronUpdaterPort = (): UpdaterPort => ({
  checkForUpdates: async () => await autoUpdater.checkForUpdates(),
  disarmAutomation() {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
  },
  downloadUpdate: async () => await autoUpdater.downloadUpdate(),
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
});

const configureUpdates = (): Updates => {
  autoUpdater.logger = {
    error: (message?: string) => {
      logUpdater(`error: ${message ?? ""}`);
    },
    info: (message?: string) => {
      logUpdater(message ?? "");
    },
    warn: (message?: string) => {
      logUpdater(`warn: ${message ?? ""}`);
    },
  };
  const created = createUpdates({
    broadcast: (state) => {
      mainWindow?.webContents.send(IPC_CHANNELS.UPDATE_STATE, state);
    },
    currentVersion: app.getVersion(),
    disabledReason: updateFeedDisabledReason(),
    log: logUpdater,
    // an adopted server is nobody's to stop and outlives the shell
    stopServer: async () => {
      await serverProcess?.stop();
    },
    updater: electronUpdaterPort(),
  });
  handleFromMainWindow(IPC_CHANNELS.UPDATE_GET_STATE, noFrame, () => created.state());
  handleFromMainWindow(
    IPC_CHANNELS.UPDATE_CHECK,
    noFrame,
    async () => await created.check("settings"),
  );
  handleFromMainWindow(IPC_CHANNELS.UPDATE_DOWNLOAD, noFrame, async () => await created.download());
  handleFromMainWindow(IPC_CHANNELS.UPDATE_INSTALL, noFrame, async () => {
    await installUpdate();
    return created.state();
  });
  return created;
};

const requireSpellcheck = (): Spellcheck => {
  if (spellcheck === null) {
    throw new Error("no window session yet");
  }
  return spellcheck;
};

// registered once per launch: a second `handle` on a channel throws, so every handler reads
// the vault of the moment rather than closing over the first one
const configureSpellcheckIpc = (): void => {
  handleFromMainWindow(IPC_CHANNELS.SPELLCHECK_GET_STATE, noFrame, () =>
    requireSpellcheck().state(),
  );
  // the frame is parsed here, at the boundary: the page's choice reaches the session typed or not at all
  handleFromMainWindow(IPC_CHANNELS.SPELLCHECK_APPLY, spellcheckChoiceSchema, (frame) =>
    requireSpellcheck().apply(frame),
  );
};

const vaultsState = (): VaultsState => {
  const target = requireTarget();
  const blocked = switchBlockedBy({ current: target, ownsServer: serverProcess !== null });
  return {
    blocked: blocked === null ? null : switchRefusalMessage(blocked),
    current: vaultRef(target.vaultDir),
    // a folder that is gone (an unmounted drive) stays remembered and stays off the list
    recent: recentVaults
      .filter((vaultDir) => vaultDir !== target.vaultDir && existsSync(vaultDir))
      .map(vaultRef),
  };
};

const setRecentVaults = (next: string[]): void => {
  recentVaults = next;
  if (recentVaultsPath !== null) {
    try {
      writeRecentVaults(recentVaultsPath, next);
    } catch (error) {
      console.warn("[desktop] could not write the recent-vaults list", error);
    }
  }
  // a menu click switches vaults, and a switch rebuilds the menu: the cycle is inherent
  // oxlint-disable-next-line no-use-before-define -- see above
  configureApplicationMenu();
};

const rememberCurrentVault = (): void => {
  setRecentVaults(rememberVault(recentVaults, requireTarget().vaultDir));
};

// the server first, then the session it answers on, then the window that loads from it
const bootVault = async (target: ServerTarget): Promise<void> => {
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
};

const switchVault = async (vaultDir: string): Promise<void> => {
  const previous = requireTarget();
  const plan = planVaultSwitch({ current: previous, ownsServer: serverProcess !== null }, vaultDir);
  if (plan.kind === "refused") {
    throw new Error(switchRefusalMessage(plan.reason));
  }
  // resolved and refused exactly as a boot would, before anything moves
  const candidate = resolveServerTarget({ env: process.env, isPackaged: app.isPackaged, vaultDir });
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
    const next = resolveServerTarget({ env: process.env, isPackaged: app.isPackaged });
    if (next.kind === "refused") {
      throw new Error(next.error);
    }
    try {
      await bootVault(next.target);
    } catch (error) {
      console.error("[desktop] the vault did not open; returning to the previous one", error);
      writeManagedVaultDir(previous.rootDataDir, previous.vaultDir);
      await stopOwnedServer();
      try {
        await bootVault(previous);
      } catch (reopenError) {
        dialog.showErrorBox(
          "Inteligir could not reopen the vault",
          `${toErrorMessage(reopenError)} Reopen Inteligir to continue.`,
        );
        app.quit();
        throw reopenError;
      }
      previousWindow?.close();
      throw new Error(`Could not open ${candidate.target.vaultDir}: ${toErrorMessage(error)}`, {
        cause: error,
      });
    }
  } finally {
    switching = false;
  }
  previousWindow?.close();
};

// the folder is the user's pick, made in main: the page never names a path it was not handed
const pickVaultDir = async (): Promise<string | null> => {
  const options: Electron.OpenDialogOptions = {
    buttonLabel: "Open vault",
    defaultPath: path.dirname(requireTarget().vaultDir),
    properties: ["openDirectory", "createDirectory"],
    title: "Open vault",
  };
  const picked =
    mainWindow === null
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(mainWindow, options);
  if (picked.canceled) {
    return null;
  }
  return picked.filePaths[0] ?? null;
};

const switchVaultFromMenu = async (vaultDir: string): Promise<void> => {
  try {
    await switchVault(vaultDir);
  } catch (error) {
    dialog.showErrorBox("Could not open the vault", toErrorMessage(error));
  }
};

const pickAndSwitchFromMenu = async (): Promise<void> => {
  const picked = await pickVaultDir();
  if (picked !== null) {
    await switchVaultFromMenu(picked);
  }
};

const configureVaultsIpc = (): void => {
  handleFromMainWindow(IPC_CHANNELS.VAULTS_GET_STATE, noFrame, () => vaultsState());
  handleFromMainWindow(IPC_CHANNELS.VAULTS_PICK, noFrame, async () => {
    const picked = await pickVaultDir();
    if (picked !== null) {
      await switchVault(picked);
    }
    return vaultsState();
  });
  // only a path this process handed out comes back: the list is the page's whole vocabulary
  handleFromMainWindow(IPC_CHANNELS.VAULTS_OPEN, vaultPathSchema, async (vaultDir) => {
    if (!recentVaults.includes(vaultDir)) {
      throw new Error("That vault is not one the app remembers.");
    }
    await switchVault(vaultDir);
    return vaultsState();
  });
  handleFromMainWindow(IPC_CHANNELS.VAULTS_FORGET, vaultPathSchema, (frame) => {
    setRecentVaults(forgetVault(recentVaults, frame));
    return vaultsState();
  });
};

const configureApplicationMenu = (): void => {
  const current = currentTarget?.vaultDir ?? null;
  const recentItems: MenuItemConstructorOptions[] = recentVaults
    .filter((vaultDir) => vaultDir !== current)
    .map((vaultDir) => ({
      click: () => {
        void switchVaultFromMenu(vaultDir);
      },
      label: vaultRef(vaultDir).name,
      sublabel: vaultDir,
    }));
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        {
          click: () => {
            void checkForUpdatesFromMenu();
          },
          label: "Check for Updates…",
        },
        { type: "separator" },
        {
          click: () => {
            openDataDir();
          },
          label: "Open Data Folder",
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
      submenu: [
        {
          click: () => {
            void pickAndSwitchFromMenu();
          },
          label: "Open Vault…",
        },
        {
          enabled: recentItems.length > 0,
          label: "Open Recent Vault",
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
          click: () => {
            if (live !== null) {
              void shell.openExternal(`${live.origin}/`);
            }
          },
          label: "Open in Browser",
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};

const createTray = (): Tray | null => {
  const icon = nativeImage
    .createFromPath(path.join(app.getAppPath(), "resources", "icon.png"))
    .resize({ height: 16, width: 16 });
  if (icon.isEmpty()) {
    console.error("[desktop] tray icon missing — skipping the tray");
    return null;
  }
  icon.setTemplateImage(true);
  const created = new Tray(icon);
  created.setToolTip(APP_DISPLAY_NAME);
  created.setContextMenu(
    Menu.buildFromTemplate([
      {
        click: () => {
          showMainWindow();
        },
        label: `Show ${APP_DISPLAY_NAME}`,
      },
      {
        click: () => {
          mainWindow?.hide();
        },
        label: "Hide",
      },
      { type: "separator" },
      {
        click: () => {
          openDataDir();
        },
        label: "Open Data Folder",
      },
      { type: "separator" },
      { role: "quit" },
    ]),
  );
  created.on("click", () => {
    showMainWindow();
  });
  return created;
};

const onAppReady = async (target: ServerTarget): Promise<void> => {
  app.setName(APP_DISPLAY_NAME);
  app.setAboutPanelOptions({
    applicationName: APP_DISPLAY_NAME,
    applicationVersion: app.getVersion(),
  });
  recentVaultsPath = path.join(app.getPath("userData"), RECENT_VAULTS_FILE_NAME);
  recentVaults = readRecentVaults(recentVaultsPath, (message) => {
    console.warn(`[desktop] ${message}`);
  });
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
};

// the tray goes with the server: once the child is down there is nothing left to show
const quitAfterTeardown = async (owned: ServerProcess): Promise<void> => {
  try {
    await owned.stop();
  } finally {
    tray?.destroy();
    tray = null;
    app.quit();
  }
};

const startApp = async (target: ServerTarget): Promise<void> => {
  try {
    await app.whenReady();
    await onAppReady(target);
  } catch (error) {
    console.error("[desktop] fatal startup error", error);
    dialog.showErrorBox("Inteligir failed to start", toErrorMessage(error));
    app.quit();
  }
};

const target = resolveServerTarget({ env: process.env, isPackaged: app.isPackaged });
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
  app.on("window-all-closed", () => {
    /* empty */
  });

  // the child's SIGTERM teardown flushes the vault's pending commit; `before-quit` is where it still has time to run.
  let teardown: Promise<void> | null = null;
  app.on("before-quit", (event) => {
    if (serverProcess === null || teardown !== null) {
      return;
    }
    event.preventDefault();
    teardown = quitAfterTeardown(serverProcess);
  });

  // two shells would race for the port and the loser would adopt the winner's server.
  if (app.requestSingleInstanceLock()) {
    app.on("second-instance", () => {
      if (live !== null) {
        showMainWindow();
      }
    });
    void startApp(target.target);
  } else {
    app.quit();
  }
}
