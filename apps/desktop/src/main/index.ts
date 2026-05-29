import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from "electron";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import type { MenuItemConstructorOptions } from "electron";
import electronUpdater from "electron-updater";

declare const __PROJECT_ROOT__: string;

// Load .env at runtime for voice API keys (ELEVENLABS_API_KEY)
try {
  process.loadEnvFile(path.resolve(__PROJECT_ROOT__, ".env"));
} catch {
  // .env file is optional
}

import {
  initParakeet,
  pushAudio,
  startSession,
  stopSession,
} from "@/main/voice/parakeet";
import { downloadModel, isModelInstalled } from "@/main/voice/model-download";

import { persistActiveTools } from "@/main/active-tools";
import { getAgent, getAppState, initMachine, shutdown, transition } from "@/main/app-machine";
import { completeOnce, listSkills } from "@/agent/setup";
import { broadcastToRenderer } from "@/main/lib/broadcast";
import { createIpcHandler, createVoidIpcHandler } from "@/main/lib/ipc-handler";
import { getNotifications } from "@/main/notifications";
import { getUiState } from "@/main/ui-state";
import { taskManager } from "@/main/tasks/task-singleton";
import { readSessionHistory } from "@/main/session-history";
import { ArtifactUpsertInputSchema, getShell } from "@/main/shell";
import { TextChatMessageSchema, type ImageAttachment } from "@/shared/voice";
import { AppEventSchema } from "@/shared/app-state";
import { CreateTaskParamsSchema } from "@/shared/task";
import { UiStateSetSchema } from "@/shared/ui-state";
import { IPC_CHANNELS, isHttpUrl, toErrorMessage } from "@/shared/ipc";
import type { ExtensionsList, SkillsList, UpdateState } from "@/shared/ipc";

const { autoUpdater } = electronUpdater;

/** Project IPC ImageAttachment payloads to pi-ai's ImageContent block shape. */
function toImageContent(images: ImageAttachment[] | undefined) {
  return images?.map((i) => ({
    type: "image" as const,
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
  broadcastToRenderer(IPC_CHANNELS.UPDATE_STATE, updateState);
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
  // ---- Desktop --------------------------------------------------------------

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

  // ---- Agent ----------------------------------------------------------------

  createIpcHandler(IPC_CHANNELS.AGENT_COMMAND, TextChatMessageSchema, (command) => {
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

  // ---- Voice ----------------------------------------------------------------

  createVoidIpcHandler(IPC_CHANNELS.VOICE_CONFIG, () => {
    const elevenlabsApiKey = process.env["ELEVENLABS_API_KEY"];
    if (!elevenlabsApiKey) return null;
    return {
      elevenlabsApiKey,
      elevenlabsVoiceId: process.env["ELEVENLABS_VOICE_ID"],
    };
  });

  createVoidIpcHandler(IPC_CHANNELS.VOICE_STT_START, async () => {
    const result = await initParakeet();
    if (!result.ok) return { ok: false, reason: result.reason };
    startSession();
    return { ok: true };
  });

  ipcMain.on(IPC_CHANNELS.VOICE_STT_AUDIO, (_event, payload: ArrayBuffer | Uint8Array) => {
    // Fire-and-forget hot path — uncaught throws on the event loop would crash
    // the app, so swallow + log and keep the session alive.
    try {
      // Honor byteOffset/byteLength: a Buffer view may sit inside a larger
      // pooled ArrayBuffer.
      const samples =
        payload instanceof ArrayBuffer
          ? new Float32Array(payload)
          : new Float32Array(payload.buffer, payload.byteOffset, payload.byteLength / 4);
      const events = pushAudio(samples);
      for (const ev of events) {
        broadcastToRenderer(IPC_CHANNELS.VOICE_STT_TRANSCRIPT, ev);
      }
    } catch (err) {
      console.error("[voice] audio chunk handler failed:", err);
    }
  });

  createVoidIpcHandler(IPC_CHANNELS.VOICE_STT_STOP, () => stopSession());

  createVoidIpcHandler(IPC_CHANNELS.VOICE_MODEL_STATUS, () =>
    isModelInstalled() ? "ready" : "missing",
  );

  createVoidIpcHandler(IPC_CHANNELS.VOICE_MODEL_DOWNLOAD, () => downloadModel());

  // ---- Notifications --------------------------------------------------------

  createVoidIpcHandler(IPC_CHANNELS.NOTIFICATIONS_GET, () => {
    return getNotifications().getSettings();
  });

  createIpcHandler(
    IPC_CHANNELS.NOTIFICATIONS_UPDATE,
    z.object({ enabled: z.boolean().optional() }),
    (patch) => {
      return getNotifications().updateSettings(patch);
    },
  );

  // ---- UI state -------------------------------------------------------------

  createVoidIpcHandler(IPC_CHANNELS.UI_STATE_GET, () => getUiState().getAll());

  createIpcHandler(IPC_CHANNELS.UI_STATE_SET, UiStateSetSchema, ({ key, value }) => {
    getUiState().set(key, value);
  });

  // ---- Extensions (#7) ------------------------------------------------------

  createVoidIpcHandler(IPC_CHANNELS.EXTENSIONS_LIST, (): ExtensionsList => {
    const agent = getAgent();
    if (!agent) return { tools: [] };
    return { tools: agent.listTools() };
  });

  createIpcHandler(
    IPC_CHANNELS.EXTENSIONS_SET_ACTIVE,
    z.array(z.string()),
    (toolNames): ExtensionsList => {
      const agent = getAgent();
      if (!agent) return { tools: [] };
      agent.setActiveTools(toolNames);
      persistActiveTools(toolNames);
      return { tools: agent.listTools() };
    },
  );

  // ---- Shell (reshapeable workspace of widgets) -----------------------------

  createVoidIpcHandler(IPC_CHANNELS.SHELL_LIST, () => {
    return getShell().list();
  });

  createIpcHandler(IPC_CHANNELS.SHELL_ADD, ArtifactUpsertInputSchema, (input) => {
    return getShell().upsertArtifact(input);
  });

  createIpcHandler(
    IPC_CHANNELS.SHELL_SET_GEOMETRY,
    z.record(
      z.string(),
      z.object({
        x: z.number(),
        y: z.number(),
        w: z.number(),
        h: z.number(),
        minW: z.number().optional(),
        minH: z.number().optional(),
      }),
    ),
    (geometries) => {
      getShell().setGeometries(geometries);
    },
  );

  createIpcHandler(
    IPC_CHANNELS.SHELL_SET_STATE,
    z.object({ id: z.string().min(1), state: z.record(z.string(), z.unknown()) }),
    ({ id, state }) => {
      return getShell().setArtifactState(id, state);
    },
  );

  createIpcHandler(IPC_CHANNELS.SHELL_REMOVE_WIDGET, z.string().min(1), (id) => {
    return { removed: getShell().removeWidget(id) };
  });

  // ---- Live widget actions --------------------------------------------------

  createIpcHandler(
    IPC_CHANNELS.ARTIFACT_COMPLETE,
    z.object({ prompt: z.string().min(1), system: z.string().optional() }),
    ({ prompt, system }) => completeOnce(prompt, system),
  );

  createIpcHandler(IPC_CHANNELS.ARTIFACT_FETCH, z.string(), async (url) => {
    // Restrict to http(s) — z.string().url() also accepts file://, ftp://,
    // etc., and this main-process fetch bypasses renderer CSP/CORS, so an
    // agent-authored fetchUrl action must not reach non-web schemes.
    if (!isHttpUrl(url)) throw new Error("Only http(s) URLs can be fetched");
    const resp = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
    // Stream-read with a hard cap so a huge/streaming body can't buffer
    // gigabytes into the main process before truncation.
    const CAP = 100_000;
    if (!resp.body) return "";
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let out = "";
    try {
      while (out.length < CAP) {
        const { done, value } = await reader.read();
        if (done) break;
        out += decoder.decode(value, { stream: true });
      }
      // Flush any trailing partial multibyte sequence the streaming decode
      // left buffered, so the last character isn't dropped or mangled.
      out += decoder.decode();
    } finally {
      await reader.cancel().catch(() => {});
    }
    return out.length > CAP ? out.slice(0, CAP) : out;
  });

  createIpcHandler(IPC_CHANNELS.ARTIFACT_OPEN_URL, z.string(), async (url) => {
    if (!isHttpUrl(url)) return false;
    await shell.openExternal(url);
    return true;
  });

  // ---- Skills ---------------------------------------------------------------

  createVoidIpcHandler(IPC_CHANNELS.SKILLS_LIST, (): SkillsList => {
    return { skills: listSkills() };
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

    mainWindow = createWindow();
    getNotifications().setTargetWindow(mainWindow);

    // Resolve session file path before initMachine() starts the agent
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
