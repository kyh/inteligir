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
import { handleChatMessage } from "@/main/dispatch/chat-bridge";
import { dispatchAgentCommand } from "@/main/dispatch/agent-gateway";
import { sendChatReply } from "@/main/dispatch/dispatch-client";
import { CHAT_MESSAGE_TYPE, parseChatMessage } from "@repo/dispatch";
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
import { isHttpUrl, toErrorMessage } from "@/shared/ipc";
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

  // All interactive agent commands funnel through the gateway, which defers
  // them while an external chat turn owns the session (see agent-gateway.ts).
  handle("sendAgentCommand", (command) => {
    // Fire-and-forget: the renderer doesn't await the result, and submission
    // errors surface in the chat panel via agent events, so swallow rejections
    // to avoid an unhandled promise.
    void dispatchAgentCommand(command).catch(() => {});
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
      // Chat-bridge messages from external interfaces run a full agent turn and
      // reply out of band — handle them before the mobile-relay switch, which
      // requires a live agent and only does fire-and-forget.
      if (msg.type === CHAT_MESSAGE_TYPE) {
        const payload = parseChatMessage(msg.payload);
        if (payload) {
          handleChatMessage(payload);
        } else {
          // Reply with an error if we can still recover the correlationId, so
          // the gateway request resolves instead of waiting out its timeout.
          const cid = (msg.payload as { correlationId?: unknown }).correlationId;
          if (typeof cid === "string") {
            sendChatReply(cid, "Sorry, that message couldn't be processed.");
          }
        }
        return;
      }

      // Mobile relay commands funnel through the same gateway as the desktop
      // UI, so they queue (rather than corrupt) an in-flight external chat turn.
      switch (msg.type) {
        case "user_message": {
          const text = (msg.payload as { text?: string }).text ?? "";
          if (text) void dispatchAgentCommand({ type: "user_message", text }).catch(() => {});
          break;
        }
        case "steer": {
          const text = (msg.payload as { text?: string }).text ?? "";
          if (text) void dispatchAgentCommand({ type: "steer", text }).catch(() => {});
          break;
        }
        case "interrupt":
          void dispatchAgentCommand({ type: "interrupt" }).catch(() => {});
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
