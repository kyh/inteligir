import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, Menu, nativeTheme, shell } from "electron";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

import type { MenuItemConstructorOptions } from "electron";
import electronUpdater from "electron-updater";

declare const PROJECT_ROOT: string;

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

import { configurePaths } from "@/agent/paths";
import { initParakeet, pushAudio, startSession, stopSession } from "@/main/voice/parakeet";
import { downloadModel, isModelInstalled } from "@/main/voice/model-download";
import { ttsAvailable, ttsFlush, ttsInterrupt, ttsSend } from "@/main/voice/tts-proxy";

import {
  getAgent,
  getAppState,
  initMachine,
  reauthenticate,
  shutdown,
  transition,
} from "@/main/app-machine";
import {
  getDispatchState,
  initDispatch,
  refreshRoomCode,
  shutdownDispatch,
} from "@/main/dispatch/dispatch-client";
import { listIntegrations, listSkills, repairIntegrations } from "@/agent/setup";
import { initAgentLog } from "@/main/lib/agent-log";
import { broadcast } from "@/main/lib/broadcast";
import { handle } from "@/main/lib/ipc-handler";
import { getNotifications } from "@/main/notifications";
import { getUiState } from "@/main/ui-state";
import { getTaskManager } from "@/main/tasks/task-manager";
import { readSessionHistory } from "@/main/session-history";
import { registerExecutorIpcHandlers } from "@/main/executor-ipc";
import { registerShellIpcHandlers } from "@/main/shell-ipc";
import { registerWidgetActionIpcHandlers } from "@/main/widget-actions";
import type { ImageAttachment } from "@/shared/voice";
import { isHttpUrl, toErrorMessage } from "@/shared/ipc";
import type { UpdateState } from "@/shared/ipc";
import type { ImageContent } from "@repo/pi-driver/pi-types";

const { autoUpdater } = electronUpdater;

/** Project IPC ImageAttachment payloads to pi-ai's ImageContent block shape. */
function toImageContent(images: ImageAttachment[] | undefined): ImageContent[] | undefined {
  return images?.map((i) => ({
    type: "image",
    data: i.data,
    mimeType: i.mimeType,
  }));
}

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
  broadcast("onUpdateState", updateState);
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
          click: () => void checkForUpdates(),
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
// IPC handlers
// ---------------------------------------------------------------------------

function registerIpcHandlers(): void {
  // ---- Desktop / updates ----------------------------------------------------

  handle("checkForUpdates", async () => {
    await checkForUpdates();
    return updateState;
  });

  handle("downloadUpdate", async () => {
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

  handle("installUpdate", () => {
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

  handle("sendAgentCommand", (command) => {
    const agent = getAgent();
    if (!agent) return;
    switch (command.type) {
      case "user_message":
        void agent.sendMessage(command.text, toImageContent(command.images));
        break;
      case "steer":
        void agent.steer(command.text, toImageContent(command.images));
        break;
      case "follow_up":
        void agent.followUp(command.text, toImageContent(command.images));
        break;
      case "interrupt":
        void agent.interrupt();
        break;
    }
  });

  handle("getAgentHistory", () => readSessionHistory());
  handle("reauthenticate", () => reauthenticate());

  // ---- Dispatch (mobile ↔ desktop relay) -----------------------------------

  handle("getDispatchState", () => getDispatchState());
  handle("refreshDispatchCode", () => refreshRoomCode());

  // ---- App lifecycle --------------------------------------------------------

  handle("getAppState", () => getAppState());
  handle("transition", (event) => {
    transition(event);
  });

  // ---- Tasks ----------------------------------------------------------------

  handle("createTask", (params) => ({ task: getTaskManager().createTask(params) }));
  handle("listTasks", () => ({ tasks: getTaskManager().getTasks() }));
  handle("deleteTask", (id): { ok: true } => {
    getTaskManager().deleteTask(id);
    return { ok: true };
  });
  handle("toggleTask", (id) => ({ task: getTaskManager().toggleTask(id) }));

  // ---- Voice ----------------------------------------------------------------

  handle("isTtsAvailable", () => ttsAvailable());
  handle("ttsSend", ({ text }) => ttsSend(text));
  handle("ttsFlush", () => ttsFlush());
  handle("ttsInterrupt", () => ttsInterrupt());

  handle("startStt", async () => {
    const result = await initParakeet();
    if (!result.ok) return { ok: false, reason: result.reason };
    startSession();
    return { ok: true };
  });

  handle("sendSttAudio", (payload) => {
    // Fire-and-forget hot path — uncaught throws on the event loop would crash
    // the app, so swallow + log and keep the session alive.
    try {
      // Honor byteOffset/byteLength: a Buffer view may sit inside a larger
      // pooled ArrayBuffer.
      const samples =
        payload instanceof ArrayBuffer
          ? new Float32Array(payload)
          : new Float32Array(
              payload.buffer,
              payload.byteOffset,
              payload.byteLength / Float32Array.BYTES_PER_ELEMENT,
            );
      const events = pushAudio(samples);
      for (const ev of events) {
        broadcast("onSttTranscript", ev);
      }
    } catch (err) {
      console.error("[voice] audio chunk handler failed:", err);
    }
  });

  handle("stopStt", () => stopSession());
  handle("getVoiceModelStatus", () => (isModelInstalled() ? "ready" : "missing"));
  handle("downloadVoiceModel", () => downloadModel());

  // ---- Notifications --------------------------------------------------------

  handle("getNotificationSettings", () => getNotifications().getSettings());
  handle("updateNotificationSettings", (patch) => getNotifications().updateSettings(patch));

  // ---- UI state -------------------------------------------------------------

  handle("getUiState", () => getUiState().getAll());
  handle("setUiState", ({ key, value }) => {
    getUiState().set(key, value);
  });

  registerShellIpcHandlers();
  registerWidgetActionIpcHandlers();
  registerExecutorIpcHandlers();

  // ---- Skills ---------------------------------------------------------------

  handle("listSkills", () => ({ skills: listSkills() }));

  // ---- Integrations (CLI binaries) ------------------------------------------

  handle("listIntegrations", () => listIntegrations());
  handle("repairIntegrations", () =>
    repairIntegrations((p) => broadcast("onSetupProgress", p)),
  );
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

/**
 * Pick the window chrome color from the persisted theme so the pre-paint
 * background matches what the renderer will render (no dark flash in light
 * mode). Mirrors the renderer's default-to-dark behaviour for unset/invalid.
 */
function startupBackgroundColor(): string {
  const stored = getUiState().getAll()["theme"];
  const theme = stored === "light" || stored === "system" ? stored : "dark";
  const dark = theme === "dark" || (theme === "system" && nativeTheme.shouldUseDarkColors);
  return dark ? "#09090b" : "#ffffff";
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    backgroundColor: startupBackgroundColor(),
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

app.on("before-quit", (event) => {
  if (isQuitting) return;
  isQuitting = true;
  event.preventDefault();
  shutdownDispatch();
  void shutdown().finally(() => {
    app.quit();
  });
});

app
  .whenReady()
  .then(() => {
    // Must run before any pi-coding-agent call that consults getAgentDir().
    configurePaths();
    initAgentLog();
    configureAppIdentity();
    configureApplicationMenu();
    configureAutoUpdater();
    registerIpcHandlers();

    mainWindow = createWindow();
    getNotifications().setTargetWindow(mainWindow);

    initMachine();

    initDispatch((msg) => {
      const agent = getAgent();
      if (!agent) return;
      switch (msg.type) {
        case "user_message": {
          const text = (msg.payload as { text?: string }).text ?? "";
          if (text) void agent.sendMessage(text);
          break;
        }
        case "steer": {
          const text = (msg.payload as { text?: string }).text ?? "";
          if (text) void agent.steer(text);
          break;
        }
        case "interrupt":
          void agent.interrupt();
          break;
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
