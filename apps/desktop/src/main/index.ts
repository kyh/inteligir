import path from "node:path";
import { z } from "zod";
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";

import type { MenuItemConstructorOptions } from "electron";
import electronUpdater from "electron-updater";

declare const __PROJECT_ROOT__: string;

// Load .env at runtime so LIVEKIT_API_KEY / LIVEKIT_API_SECRET are available
// on process.env without being baked into the compiled bundle.
try {
  process.loadEnvFile(path.resolve(__PROJECT_ROOT__, ".env"));
} catch {
  // .env file is optional — env vars may be set externally
}

import { getAppState, initMachine, shutdown, transition } from "@/main/app-machine";
import { createIpcHandler, createVoidIpcHandler } from "@/main/lib/ipc-handler";
import { taskManager } from "@/main/tasks/task-singleton";
import { registerAgentIpcHandlers, warmupNodePath } from "@/main/voice/livekit-ipc";
import { readSessionHistory } from "@/main/session-history";
import { AppEventSchema } from "@/shared/app-state";
import { CreateTaskParamsSchema } from "@/shared/task";
import { IPC_CHANNELS, MENU_ACTIONS, isHttpUrl, toErrorMessage } from "@/shared/ipc";
import type { UpdateState } from "@/shared/ipc";

const { autoUpdater } = electronUpdater;

const isDevelopment = !app.isPackaged;
const STARTUP_UPDATE_DELAY_MS = 15_000;
const APP_DISPLAY_NAME = isDevelopment ? "Inteligir (Dev)" : "Inteligir";

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

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
// App identity & menu
// ---------------------------------------------------------------------------

function configureAppIdentity(): void {
  app.setName(APP_DISPLAY_NAME);
  app.setAboutPanelOptions({
    applicationName: APP_DISPLAY_NAME,
    applicationVersion: app.getVersion(),
  });
}

function dispatchMenuAction(action: string): void {
  const win =
    BrowserWindow.getFocusedWindow() ?? mainWindow ?? BrowserWindow.getAllWindows()[0];
  if (!win) return;

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

  createVoidIpcHandler(IPC_CHANNELS.UPDATE_CHECK, async () => {
    await checkForUpdates();
    return updateState;
  });

  createVoidIpcHandler(IPC_CHANNELS.UPDATE_DOWNLOAD, async () => {
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

  createVoidIpcHandler(IPC_CHANNELS.UPDATE_INSTALL, () => {
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

  // ---- Agent history (read directly from session files on disk) ------------

  ipcMain.handle(IPC_CHANNELS.AGENT_HISTORY, () => readSessionHistory());

  // ---- App lifecycle --------------------------------------------------------

  createVoidIpcHandler(IPC_CHANNELS.APP_GET_STATE, () => getAppState());

  createIpcHandler(IPC_CHANNELS.APP_TRANSITION, AppEventSchema, (event) => {
    transition(event);
  });

  // ---- Tasks ----------------------------------------------------------------

  createIpcHandler(IPC_CHANNELS.TASK_CREATE, CreateTaskParamsSchema, (params) => {
    return { task: taskManager.createTask(params) };
  });

  createVoidIpcHandler(IPC_CHANNELS.TASK_LIST, () => {
    return { tasks: taskManager.getTasks() };
  });

  createIpcHandler(IPC_CHANNELS.TASK_DELETE, z.string().min(1), (id) => {
    taskManager.deleteTask(id);
    return { ok: true as const };
  });

  createIpcHandler(IPC_CHANNELS.TASK_TOGGLE, z.string().min(1), (id) => {
    return { task: taskManager.toggleTask(id) };
  });
}

// ---------------------------------------------------------------------------
// Auto-updater
// ---------------------------------------------------------------------------

async function checkForUpdates(): Promise<void> {
  if (isDevelopment) return;

  setUpdateState({ status: "checking", message: null, downloadPercent: null });

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
    setUpdateState({ status: "downloading", downloadPercent: Math.floor(progress.percent) });
  });

  autoUpdater.on("update-downloaded", (info) => {
    setUpdateState({ status: "downloaded", version: info.version, downloadPercent: 100 });
  });

  autoUpdater.on("error", (error) => {
    setUpdateState({ status: "error", message: error.message });
  });

  setTimeout(() => void checkForUpdates(), STARTUP_UPDATE_DELAY_MS);
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
    backgroundColor: "#d1684e",
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
  void shutdown().finally(() => {
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

    // Voice — LiveKit sidecar + token generation
    // Agent events are forwarded from sidecar via livekit-ipc → app-machine
    warmupNodePath(); // Pre-resolve system Node.js path before first voice use
    const unregisterVoiceIpc = registerAgentIpcHandlers();

    // Clean up on quit
    app.on("will-quit", () => {
      unregisterVoiceIpc();
    });

    mainWindow = createWindow();

    // Pre-read session history so the resolved session file path is available
    // before initMachine() spawns the sidecar (which reads it via env var).
    readSessionHistory();

    initMachine();
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
