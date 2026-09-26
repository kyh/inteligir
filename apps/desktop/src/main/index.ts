import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import type { z } from "zod";
import path from "node:path";
import { autoUpdater } from "electron-updater";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  MessageChannelMain,
  nativeImage,
  nativeTheme,
  session,
  shell,
  Tray,
  utilityProcess,
} from "electron";
import type { ForkOptions, MenuItemConstructorOptions, UtilityProcess } from "electron";
import { rendererDir, appPreloadScript } from "./bundle-paths";
import { socketCredentialFilter } from "./credential-scope";
import { isDirectory, resolveShellPath, runShell } from "./login-shell-path";
import type { ShellPathResolution } from "./login-shell-path";
import {
  appWindowWebPreferences,
  classifyNavigation,
  classifyWindowOpen,
  decideExternalOpen,
  grantsActivation,
} from "./origin-pin";
import { registerAppProtocol, registerAppScheme } from "./protocol";
import { APP_ORIGIN, carriesBearer } from "./protocol-handler";
import { createForkBroker } from "./fork-broker";
import { createServerProcess } from "./server-process";
import type { ServerProcess } from "./server-process";
import { createSpellcheck, senderIsWindow } from "./spellcheck";
import type { Spellcheck } from "./spellcheck";
import { createUpdates } from "./updates";
import type { UpdaterPort, Updates } from "./updates";
import { resolveVaultEntry } from "./vault-entry";
import {
  browserSignInUrl,
  bundledServerVersion,
  describeServerVerdict,
  planServerStart,
  resolveServerTarget,
  serverEntryPath,
  serverProcessEnv,
  sessionPartition,
  verifyServer,
} from "./server-instance";
import type { LiveServer, ServerTarget, ServerVerdict } from "./server-instance";
import {
  forgetVault,
  offeredRecentVaults,
  planVaultSwitch,
  readRecentVaults,
  rememberVault,
  runVaultSwitch,
  switchBlockedBy,
  switchRefusalMessage,
  vaultRef,
  writeRecentVaults,
} from "./vaults";
import type { VaultSwitchOutcome } from "./vaults";
import { forkRequestSchema } from "inteligir/server/child-host/fork-broker-wire";
import { writeManagedVaultDir } from "inteligir/server/config";
import { authorizationHeader } from "inteligir/server/server-file";
import { INVOKE_ROUTES, SOCKET_ORIGIN_CHANNEL, UPDATE_STATE_PUSH } from "../ipc-contract";
import type { InvokeRoute, PushRoute } from "../ipc-contract";
import type { PathActionRequest, PathActionResult } from "../path-action";
import { toErrorMessage } from "../types";
import type { VaultSwitchAnswer, VaultsState } from "../vaults-state";

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
// a quit mid-boot stops the child the boot is waiting on, so the boot's failure is the quit's
let quitRequested = false;

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

const judgeServer = async (
  target: ServerTarget,
  expectedVersion: string,
): Promise<ServerVerdict> => {
  const verdict = await verifyServer(target.dataDir, expectedVersion);
  if (verdict.kind !== "verified" && verdict.kind !== "none") {
    console.warn(`[desktop] ${describeServerVerdict(verdict, target.dataDir)}`);
  }
  return verdict;
};

const forkServer = (modulePath: string, args: string[], options: ForkOptions): UtilityProcess => {
  const server = utilityProcess.fork(modulePath, args, options);
  const broker = createForkBroker({
    createChannel: () => new MessageChannelMain(),
    fork: (childPath, childArgs, childOptions) =>
      utilityProcess.fork(childPath, childArgs, childOptions),
    log: (message) => {
      console.warn(`[desktop] ${message}`);
    },
    reply: (message, transfer) => {
      server.postMessage(message, transfer);
    },
  });
  server.on("message", (message) => {
    const request = forkRequestSchema.safeParse(message);
    if (request.success) {
      broker.fork(request.data);
    }
  });
  server.once("exit", () => {
    broker.dispose();
  });
  return server;
};

const startServer = async (target: ServerTarget): Promise<void> => {
  const expectedVersion = bundledServerVersion(app.getAppPath());
  const plan = planServerStart(await judgeServer(target, expectedVersion), target.dataDir);
  if (plan.kind === "refuse") {
    throw new Error(plan.reason);
  }
  if (plan.kind === "adopt") {
    console.log(`[desktop] adopting the server already serving ${target.dataDir}`);
    ({ live } = plan);
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
    fork: forkServer,
    // a child that lost the port race must not be reported up about a stranger.
    isReady: async () => {
      const verdict = await judgeServer(target, expectedVersion);
      if (verdict.kind !== "verified") {
        return false;
      }
      ({ live } = verdict);
      return true;
    },
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

// Electron grants most permissions by default and the app needs none, dictation included: it is
// the operating system's. both handlers are needed: the request handler answers a prompt, the
// check handler answers `navigator.permissions.query`.
const lockDownSession = (partition: string): Electron.Session => {
  const windowSession = session.fromPartition(partition);
  windowSession.setPermissionRequestHandler((_contents, _permission, respond) => {
    respond(false);
  });
  windowSession.setPermissionCheckHandler(() => false);
  // device pickers are not covered by the permission handlers.
  windowSession.setDevicePermissionHandler(() => false);
  return windowSession;
};

// a browser `WebSocket` cannot set a header and cannot be proxied by the protocol handler.
// a session revisited on a later switch gets the new bearer: the listener replaces the last.
const attachSocketCredential = (windowSession: Electron.Session, server: LiveServer): void => {
  const urls = socketCredentialFilter(server.origin);
  windowSession.webRequest.onBeforeSendHeaders({ urls }, (details, respond) => {
    if (!carriesBearer(details.initiatorOrigin)) {
      respond({});
      return;
    }
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

const loadWindow = async (window: BrowserWindow, url: string): Promise<void> => {
  try {
    await window.loadURL(url);
  } catch (error) {
    console.error(`[desktop] window failed to load ${url}: ${toErrorMessage(error)}`);
  }
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

  window.webContents.on("input-event", (_event, input) => {
    if (grantsActivation(input.type)) {
      lastInputAt = Date.now();
    }
  });

  window.webContents.setWindowOpenHandler((details) => {
    if (classifyWindowOpen(details.url) === "deny-and-open-external") {
      openExternalFromPage(details.url);
    }
    return { action: "deny" };
  });

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

  // the packaged smoke reads these lines: the fuses change what a page may load
  window.webContents.once("did-finish-load", () => {
    console.log("[desktop] window loaded");
  });
  window.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
      if (isMainFrame) {
        console.error(
          `[desktop] window failed to load ${validatedUrl}: ${String(errorCode)} ${errorDescription}`,
        );
      }
    },
  );

  void loadWindow(window, `${APP_ORIGIN}/`);
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
const handle = <Request extends z.ZodType, Answer extends z.ZodType>(
  route: InvokeRoute<Request, Answer>,
  handler: (request: z.output<Request>) => z.input<Answer> | Promise<z.input<Answer>>,
): void => {
  ipcMain.handle(route.channel, async (event, frame) => {
    if (!fromMainWindow(event)) {
      throw new Error("refused");
    }
    return await handler(route.request.parse(frame));
  });
};

const push = <Frame extends z.ZodType>(route: PushRoute<Frame>, frame: z.input<Frame>): void => {
  mainWindow?.webContents.send(route.channel, frame);
};

const resolveRequestedEntry = (request: PathActionRequest) =>
  resolveVaultEntry({
    path: request.path,
    realpath: realpathSync,
    vaultDir: requireTarget().vaultDir,
  });

// the page names an entry vault-relative; main resolves it against the vault of the moment
// and hands the OS nothing the vault does not physically contain. registered once per
// launch: a second `handle` on a channel throws, so the handlers read the current vault
const configurePathActionsIpc = (): void => {
  handle(INVOKE_ROUTES.paths.reveal, (request): PathActionResult => {
    const verdict = resolveRequestedEntry(request);
    if (!verdict.ok) {
      return verdict;
    }
    shell.showItemInFolder(verdict.absPath);
    return { ok: true };
  });
  handle(INVOKE_ROUTES.paths.open, async (request): Promise<PathActionResult> => {
    const verdict = resolveRequestedEntry(request);
    if (!verdict.ok) {
      return verdict;
    }
    // answers "" when the OS took the file, else its own words for why not
    const refusal = await shell.openPath(verdict.absPath);
    return refusal === "" ? { ok: true } : { ok: false, reason: refusal };
  });
};

// the server is already down when an install fails, so the honest move is to say so and quit
const reportInstallFailure = (message: string): void => {
  dialog.showErrorBox("Update failed", `${message} Reopen Inteligir to continue.`);
  app.quit();
};

const installUpdate = async (): Promise<void> => {
  if (updates === null) {
    return;
  }
  const outcome = await updates.install();
  if (outcome.kind === "failed") {
    reportInstallFailure(outcome.message);
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
        message: `Inteligir ${state.version} is available.`,
        title: "Update available",
        type: "info",
      });
      if (response !== 0) {
        return;
      }
      const downloaded = await updates.download();
      if (downloaded.status === "downloaded") {
        await askToRestart(downloaded.version);
      } else if (downloaded.status === "error") {
        dialog.showErrorBox("Download failed", downloaded.message);
      }
      return;
    }
    case "downloaded": {
      await askToRestart(state.version);
      return;
    }
    case "disabled": {
      await dialog.showMessageBox({
        buttons: ["OK"],
        message: state.reason,
        title: "Updates are off",
        type: "warning",
      });
      return;
    }
    case "error": {
      await dialog.showMessageBox({
        buttons: ["OK"],
        message: state.message,
        title: "Update check failed",
        type: "warning",
      });
      return;
    }
    default: {
      const exhaustive: never = state;
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
      push(UPDATE_STATE_PUSH, state);
    },
    currentVersion: app.getVersion(),
    disabledReason: updateFeedDisabledReason(),
    log: logUpdater,
    onInstallFailed: reportInstallFailure,
    // an adopted server is nobody's to stop and outlives the shell
    stopServer: async () => {
      await serverProcess?.stop();
    },
    updater: electronUpdaterPort(),
  });
  handle(INVOKE_ROUTES.updates.getState, () => created.state());
  handle(INVOKE_ROUTES.updates.check, async () => await created.check("settings"));
  handle(INVOKE_ROUTES.updates.download, async () => await created.download());
  handle(INVOKE_ROUTES.updates.install, async () => {
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
  handle(INVOKE_ROUTES.spellcheck.getState, () => requireSpellcheck().state());
  handle(INVOKE_ROUTES.spellcheck.apply, (choice) => requireSpellcheck().apply(choice));
};

const vaultsState = (): VaultsState => {
  const target = requireTarget();
  const blocked = switchBlockedBy({ current: target, ownsServer: serverProcess !== null });
  return {
    blocked: blocked === null ? null : switchRefusalMessage(blocked),
    current: vaultRef(target.vaultDir),
    recent: offeredRecentVaults(recentVaults, target.vaultDir, existsSync).map(vaultRef),
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

const switchVault = async (vaultDir: string): Promise<VaultSwitchOutcome> => {
  const previous = requireTarget();
  const plan = planVaultSwitch({ current: previous, ownsServer: serverProcess !== null }, vaultDir);
  if (plan.kind === "refused") {
    return { ok: false, reason: switchRefusalMessage(plan.reason) };
  }
  // resolved and refused exactly as a boot would, before anything moves
  const candidate = resolveServerTarget({ env: process.env, isPackaged: app.isPackaged, vaultDir });
  if (candidate.kind === "refused") {
    return { ok: false, reason: candidate.error };
  }
  if (switching) {
    return { ok: false, reason: "Another vault is already opening." };
  }
  switching = true;
  const previousWindow = mainWindow;
  try {
    return await runVaultSwitch(
      {
        abandon: (reason) => {
          dialog.showErrorBox("Inteligir could not reopen the vault", reason);
          app.quit();
        },
        boot: bootVault,
        closeRequestingWindow: () => {
          previousWindow?.close();
        },
        log: (message, cause) => {
          console.error(`[desktop] ${message}`, cause);
        },
        reportFailure: (reason) => {
          dialog.showErrorBox("Could not open the vault", reason);
        },
        resolveTarget: () => {
          const next = resolveServerTarget({ env: process.env, isPackaged: app.isPackaged });
          if (next.kind === "refused") {
            throw new Error(next.error);
          }
          return next.target;
        },
        stopServer: stopOwnedServer,
        writeSelector: (selected) => {
          writeManagedVaultDir(previous.rootDataDir, selected);
        },
      },
      previous,
      candidate.target.vaultDir,
    );
  } finally {
    switching = false;
  }
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
  let outcome: VaultSwitchOutcome;
  try {
    outcome = await switchVault(vaultDir);
  } catch (error) {
    outcome = { ok: false, reason: toErrorMessage(error) };
  }
  if (!outcome.ok && !("reported" in outcome)) {
    dialog.showErrorBox("Could not open the vault", outcome.reason);
  }
};

const openInBrowserFromMenu = async (): Promise<void> => {
  const server = live;
  if (server === null) {
    return;
  }
  try {
    await shell.openExternal(await browserSignInUrl(server));
  } catch (error) {
    dialog.showErrorBox("Could not open Inteligir in the browser", toErrorMessage(error));
  }
};

const pickAndSwitchFromMenu = async (): Promise<void> => {
  const picked = await pickVaultDir();
  if (picked !== null) {
    await switchVaultFromMenu(picked);
  }
};

const answerSwitch = (outcome: VaultSwitchOutcome): VaultSwitchAnswer =>
  outcome.ok ? { ok: true, state: vaultsState() } : { ok: false, reason: outcome.reason };

const configureVaultsIpc = (): void => {
  handle(INVOKE_ROUTES.vaults.getState, () => vaultsState());
  handle(INVOKE_ROUTES.vaults.pick, async () => {
    const picked = await pickVaultDir();
    return answerSwitch(picked === null ? { ok: true } : await switchVault(picked));
  });
  // only a path this process handed out comes back: the list is the page's whole vocabulary
  handle(INVOKE_ROUTES.vaults.open, async (vaultDir): Promise<VaultSwitchAnswer> => {
    if (!recentVaults.includes(vaultDir)) {
      return { ok: false, reason: "That vault is not one the app remembers." };
    }
    return answerSwitch(await switchVault(vaultDir));
  });
  handle(INVOKE_ROUTES.vaults.forget, (vaultDir) => {
    setRecentVaults(forgetVault(recentVaults, vaultDir));
    return vaultsState();
  });
};

const configureApplicationMenu = (): void => {
  const current = currentTarget?.vaultDir ?? null;
  const recentItems: MenuItemConstructorOptions[] = offeredRecentVaults(
    recentVaults,
    current,
    existsSync,
  ).map((vaultDir) => ({
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
            void openInBrowserFromMenu();
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
  ipcMain.on(SOCKET_ORIGIN_CHANNEL, (event) => {
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

// on main's own env, so every fork inherits it: the first boot's child and every vault switch's
const applyShellPath = (resolution: ShellPathResolution): void => {
  if (resolution.source === "inherited") {
    return;
  }
  if (resolution.source === "fallback") {
    console.warn(
      `[desktop] could not read the login shell's PATH (${resolution.reason}); adding the usual install dirs instead`,
    );
  }
  process.env.PATH = resolution.path;
};

const startApp = async (target: ServerTarget): Promise<void> => {
  try {
    // asked while Electron readies, so the login shell's startup overlaps a wait the boot has anyway
    const shellPath = resolveShellPath({
      env: process.env,
      homeDir: homedir(),
      isDirectory,
      isPackaged: app.isPackaged,
      platform: process.platform,
      run: runShell,
    });
    await app.whenReady();
    applyShellPath(await shellPath);
    await onAppReady(target);
  } catch (error) {
    // the teardown in flight quits once the child is down; a modal here would hold main open
    if (quitRequested) {
      console.warn(`[desktop] startup ended by a quit: ${toErrorMessage(error)}`);
      return;
    }
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
    quitRequested = true;
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
