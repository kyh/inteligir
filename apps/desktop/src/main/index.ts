import path from "node:path";

import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import type { MenuItemConstructorOptions } from "electron";
import electronUpdater from "electron-updater";

import { Agent, isLoggedIn, login, logout } from "./agent";
import { createTask, deleteTask, getTasks, toggleTask } from "./task-store";
import { TaskScheduler } from "./task-scheduler";
import { ToolManager } from "./tool-manager";
import { CreateTaskParamsSchema } from "../shared/task";
import { IPC_CHANNELS, MENU_ACTIONS, isHttpUrl, toErrorMessage } from "../shared/ipc";
import type { UpdateState } from "../shared/ipc";

const { autoUpdater } = electronUpdater;

const isDevelopment = !app.isPackaged;
/** Delay before first update check so the app finishes loading first. */
const STARTUP_UPDATE_DELAY_MS = 15_000;
const APP_DISPLAY_NAME = isDevelopment ? "Inteligir (Dev)" : "Inteligir";

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

/** In-process agent instance */
let agent: Agent | null = null;
let scheduler: TaskScheduler | null = null;
const toolManager = new ToolManager();

// ---------------------------------------------------------------------------
// Auto-updater state
// ---------------------------------------------------------------------------

let updateState: UpdateState = {
  status: "idle",
  version: null,
  downloadPercent: null,
  message: null,
};

function setUpdateState(patch: Partial<UpdateState>): void {
  updateState = { ...updateState, ...patch };
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.UPDATE_STATE, updateState);
    }
  }
}

// ---------------------------------------------------------------------------
// Agent event forwarding (main → renderer via IPC)
// ---------------------------------------------------------------------------

function broadcastAgentEvent(event: unknown): void {
  const type = typeof event === "object" && event !== null && "type" in event
    ? (event as Record<string, unknown>).type
    : "unknown";
  console.log("[ipc] broadcasting agent event:", type);
  if (type === "message_end") {
    const msg = (event as Record<string, unknown>).message as Record<string, unknown> | undefined;
    if (msg?.stopReason === "error") {
      console.error("[ipc] message_end ERROR:", msg.errorMessage);
    }
  }

  // pi-agent-core events contain class instances (e.g. message.api) that
  // can't survive Electron's structured-clone IPC. Round-trip through JSON
  // to strip non-serializable fields.
  let safe: unknown;
  try {
    safe = JSON.parse(JSON.stringify(event));
  } catch (err) {
    console.error("[ipc] failed to serialize event:", type, err);
    return;
  }
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.AGENT_EVENT, safe);
    }
  }
}

// ---------------------------------------------------------------------------
// App identity
// ---------------------------------------------------------------------------

function configureAppIdentity(): void {
  app.setName(APP_DISPLAY_NAME);
  app.setAboutPanelOptions({
    applicationName: APP_DISPLAY_NAME,
    applicationVersion: app.getVersion(),
  });
}

// ---------------------------------------------------------------------------
// Application menu
// ---------------------------------------------------------------------------

function ensureWindow(): BrowserWindow {
  const existing =
    BrowserWindow.getFocusedWindow() ?? mainWindow ?? BrowserWindow.getAllWindows()[0];
  if (existing) return existing;
  mainWindow = createWindow();
  return mainWindow;
}

function dispatchMenuAction(action: string): void {
  const win = ensureWindow();

  const send = () => {
    if (win.isDestroyed()) return;
    if (!win.isVisible()) win.show();
    win.focus();
    win.webContents.send(IPC_CHANNELS.MENU_ACTION, action);
  };

  if (win.webContents.isLoadingMainFrame()) {
    win.webContents.once("did-finish-load", send);
    return;
  }

  send();
}

function configureApplicationMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        {
          label: "Check for Updates...",
          click: () => void checkForUpdates(),
        },
        { type: "separator" },
        {
          label: "Settings...",
          accelerator: "CmdOrCtrl+,",
          click: () => dispatchMenuAction(MENU_ACTIONS.OPEN_SETTINGS),
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
        { role: "close" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

function requireAgent(): Agent {
  if (!agent) throw new Error("Agent not started");
  return agent;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} (string) is required`);
  }
  return value;
}

function registerIpcHandlers(): void {
  // ---- Desktop --------------------------------------------------------------

  ipcMain.handle(IPC_CHANNELS.OPEN_EXTERNAL, async (_event, rawUrl: unknown) => {
    if (typeof rawUrl !== "string" || rawUrl.length === 0) return false;
    if (!isHttpUrl(rawUrl)) return false;

    try {
      await shell.openExternal(rawUrl);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle(IPC_CHANNELS.UPDATE_CHECK, async () => {
    await checkForUpdates();
    return updateState;
  });

  ipcMain.handle(IPC_CHANNELS.UPDATE_DOWNLOAD, async () => {
    if (updateState.status !== "available") {
      return { accepted: false, state: updateState };
    }
    try {
      setUpdateState({ status: "downloading", downloadPercent: 0 });
      await autoUpdater.downloadUpdate();
      return { accepted: true, state: updateState };
    } catch (error: unknown) {
      setUpdateState({ status: "error", message: toErrorMessage(error) });
      return { accepted: false, state: updateState };
    }
  });

  ipcMain.handle(IPC_CHANNELS.UPDATE_INSTALL, (_event) => {
    if (updateState.status !== "downloaded") {
      return { accepted: false, state: updateState };
    }
    setImmediate(() => {
      isQuitting = true;
      try {
        autoUpdater.quitAndInstall();
      } catch (error: unknown) {
        isQuitting = false;
        setUpdateState({ status: "error", message: toErrorMessage(error) });
      }
    });
    return { accepted: true, state: updateState };
  });

  // ---- Agent ----------------------------------------------------------------

  ipcMain.handle(IPC_CHANNELS.AGENT_SEND_MESSAGE, (_event, raw: unknown) => {
    console.log("[ipc] AGENT_SEND_MESSAGE received");
    return requireAgent().sendMessage(requireString(raw, "message"));
  });

  ipcMain.handle(IPC_CHANNELS.AGENT_STEER, (_event, raw: unknown) => {
    return requireAgent().steer(requireString(raw, "message"));
  });

  ipcMain.handle(IPC_CHANNELS.AGENT_INTERRUPT, () => {
    return requireAgent().interrupt();
  });

  ipcMain.handle(IPC_CHANNELS.AGENT_GET_STATE, () => {
    return requireAgent().getState();
  });

  ipcMain.handle(IPC_CHANNELS.AGENT_CLEAR, () => {
    requireAgent().clear();
    return { ok: true };
  });

  // ---- Auth -----------------------------------------------------------------

  ipcMain.handle(IPC_CHANNELS.AUTH_LOGIN, async () => {
    try {
      await login();
      // Restart agent with new credentials
      const a = requireAgent();
      await a.stop();
      await a.start();
      return { ok: true };
    } catch (error: unknown) {
      return { ok: false, error: toErrorMessage(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_LOGOUT, async () => {
    logout();
    // Restart agent without credentials
    const a = requireAgent();
    await a.stop();
    await a.start();
    return { ok: true };
  });

  // ---- Settings -------------------------------------------------------------

  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, () => {
    return { loggedIn: isLoggedIn() } as const;
  });

  // ---- Tasks ----------------------------------------------------------------

  ipcMain.handle(IPC_CHANNELS.TASK_CREATE, (_event, raw: unknown) => {
    const params = CreateTaskParamsSchema.parse(raw);
    return { task: createTask(params) };
  });

  ipcMain.handle(IPC_CHANNELS.TASK_LIST, () => {
    return { tasks: getTasks() };
  });

  ipcMain.handle(IPC_CHANNELS.TASK_DELETE, (_event, raw: unknown) => {
    deleteTask(requireString(raw, "id"));
    return { ok: true };
  });

  ipcMain.handle(IPC_CHANNELS.TASK_TOGGLE, (_event, raw: unknown) => {
    return { task: toggleTask(requireString(raw, "id")) };
  });
}

// ---------------------------------------------------------------------------
// Auto-updater
// ---------------------------------------------------------------------------

async function checkForUpdates(): Promise<void> {
  if (isDevelopment) return;

  setUpdateState({
    status: "checking",
    message: null,
    downloadPercent: null,
  });

  try {
    await autoUpdater.checkForUpdates();
  } catch (error: unknown) {
    setUpdateState({ status: "error", message: toErrorMessage(error) });
  }
}

function configureAutoUpdater(): void {
  if (isDevelopment) return;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on("update-available", (info) => {
    setUpdateState({ status: "available", version: info.version });
  });

  autoUpdater.on("update-not-available", () => {
    setUpdateState({ status: "not-available" });
  });

  autoUpdater.on("download-progress", (progress) => {
    setUpdateState({
      status: "downloading",
      downloadPercent: Math.floor(progress.percent),
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    setUpdateState({
      status: "downloaded",
      version: info.version,
      downloadPercent: 100,
    });
  });

  autoUpdater.on("error", (error) => {
    setUpdateState({ status: "error", message: error.message });
  });

  setTimeout(() => void checkForUpdates(), STARTUP_UPDATE_DELAY_MS);
}

// ---------------------------------------------------------------------------
// Agent lifecycle
// ---------------------------------------------------------------------------

async function startAgent(): Promise<void> {
  process.stderr.write("[desktop] starting agent...\n");
  console.log("[desktop] starting agent...");
  try {
    // Auto-install CLI tools (agent-browser, etc.) — skips if already present
    await toolManager.ensureAll();

    agent = new Agent();
    agent.subscribe(broadcastAgentEvent);
    await agent.start();
    console.log("[desktop] agent started");

    scheduler = new TaskScheduler(() => agent);
    scheduler.start();
  } catch (err) {
    console.error("[desktop] agent start failed:", err);
    // Broadcast error to renderer so user sees it instead of silent failure
    broadcastAgentEvent({
      type: "agent_status",
      status: "error",
      error: toErrorMessage(err),
    });
  }
}

/** Graceful shutdown: wait up to 5s for agent to finish, then force-stop. */
const SHUTDOWN_TIMEOUT_MS = 5_000;

async function stopAgent(): Promise<void> {
  scheduler?.stop();
  scheduler = null;

  if (agent) {
    const idle = await agent.waitForIdle(SHUTDOWN_TIMEOUT_MS);
    if (!idle) {
      console.warn("[desktop] agent did not reach idle within timeout, force-stopping");
    }
    await agent.stop();
    agent = null;
  }
}

// ---------------------------------------------------------------------------
// Window creation
// ---------------------------------------------------------------------------

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: APP_DISPLAY_NAME,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
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

  window.once("ready-to-show", () => {
    window.show();
  });

  if (isDevelopment && process.env["ELECTRON_RENDERER_URL"]) {
    void window.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void window.loadFile(path.join(__dirname, "../renderer/index.html"));
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

app.on("before-quit", (event) => {
  if (isQuitting) return;
  isQuitting = true;
  event.preventDefault();
  void stopAgent().finally(() => {
    app.quit();
  });
});

app
  .whenReady()
  .then(async () => {
    configureAppIdentity();
    configureApplicationMenu();
    configureAutoUpdater();
    registerIpcHandlers();

    await startAgent();

    mainWindow = createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow();
      } else {
        mainWindow?.show();
        mainWindow?.focus();
      }
    });
  })
  .catch((error) => {
    console.error("[desktop] fatal startup error", error);
    dialog.showErrorBox("Inteligir failed to start", toErrorMessage(error));
    app.quit();
  });

// Handle POSIX signals for clean shutdown
const handleSignal = () => {
  if (isQuitting) return;
  isQuitting = true;
  app.quit();
};
process.on("SIGINT", handleSignal);
process.on("SIGTERM", handleSignal);
