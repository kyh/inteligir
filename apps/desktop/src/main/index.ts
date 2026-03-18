import path from "node:path";

import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import type { MenuItemConstructorOptions } from "electron";
import electronUpdater from "electron-updater";

import { getAgent, getAppState, initMachine, onAgentEvent, shutdown, transition } from "@/main/app-machine";
import { createTask, deleteTask, getTasks, toggleTask } from "@/main/tasks/task-store";
import { VoiceService } from "@/main/voice/voice-service";
import { registerVoiceIpcHandlers } from "@/main/voice/voice-ipc";
import { CreateTaskParamsSchema } from "@/shared/task";
import { IPC_CHANNELS, MENU_ACTIONS, extractText, isHttpUrl, isRecord, toErrorMessage } from "@/shared/ipc";
import type { AppEvent } from "@/shared/app-state";
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
// Agent event forwarding (main -> renderer via IPC)
// ---------------------------------------------------------------------------

function broadcastAgentEvent(event: unknown): void {
  const type = isRecord(event) && "type" in event ? event.type : "unknown";

  if (type === "message_end" && isRecord(event)) {
    const msg = isRecord(event.message) ? event.message : undefined;
    if (msg?.stopReason === "error") {
      console.error("[agent] message error:", msg.errorMessage);
    }
  }

  let safe: unknown;
  try {
    safe = JSON.parse(JSON.stringify(event));
  } catch (err) {
    console.error("[agent] failed to serialize event:", type, err);
    return;
  }
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.AGENT_EVENT, safe);
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

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} (string) is required`);
  }
  return value;
}

function requireAgent() {
  const agent = getAgent();
  if (!agent) throw new Error("Agent not started");
  return agent;
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

  // ---- App lifecycle --------------------------------------------------------

  ipcMain.handle(IPC_CHANNELS.APP_GET_STATE, () => getAppState());

  ipcMain.handle(IPC_CHANNELS.APP_TRANSITION, (_event, raw: unknown) => {
    transition(raw as AppEvent);
  });

  // ---- Agent ----------------------------------------------------------------

  ipcMain.handle(IPC_CHANNELS.AGENT_SEND_MESSAGE, (_event, raw: unknown) => {
    return requireAgent().sendMessage(requireString(raw, "message"));
  });

  ipcMain.handle(IPC_CHANNELS.AGENT_STEER, (_event, raw: unknown) => {
    return requireAgent().steer(requireString(raw, "message"));
  });

  ipcMain.handle(IPC_CHANNELS.AGENT_INTERRUPT, () => {
    return requireAgent().interrupt();
  });

  ipcMain.handle(IPC_CHANNELS.AGENT_CLEAR, () => {
    getAgent()?.clear();
    return { ok: true };
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

    // Voice service — STT + TTS via ElevenLabs
    const voiceService = new VoiceService(() => getAgent());
    const unregisterVoiceIpc = registerVoiceIpcHandlers(voiceService);

    // Forward raw agent session events to renderer for chat streaming
    const unsubAgentEvents = onAgentEvent((event) => {
      broadcastAgentEvent(event);

      // When voice is active and agent finishes a response, trigger TTS
      if (
        voiceService.isActive() &&
        isRecord(event) &&
        event.type === "message_end" &&
        isRecord(event.message) &&
        event.message.role === "assistant"
      ) {
        const text = extractText(event.message);
        console.log("[voice] extracted text from agent response:", text.slice(0, 100) || "(empty)");
        if (text) voiceService.handleAgentResponse(text);
      }
    });

    // Clean up voice resources on quit
    app.on("will-quit", () => {
      voiceService.stop();
      unsubAgentEvents();
      unregisterVoiceIpc();
    });

    mainWindow = createWindow();
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
