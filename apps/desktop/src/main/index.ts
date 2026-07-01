import { spawn } from "node:child_process";
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

import { getAppState, initMachine, reauthenticate, shutdown, transition } from "@/main/app-machine";
import { dispatchAgentCommand } from "@/main/agent-gateway";
import { getDelegationManager } from "@/main/delegation/delegation-manager";
import { generateInline } from "@/main/inline-ai";
import { listIntegrations, listSkills, repairIntegrations } from "@/agent/setup";
import { getAgentPorts } from "@/main/lib/agent-lifecycle";
import { initAgentLog } from "@/main/lib/agent-log";
import { emitEvent, subscribeEvents } from "@/main/lib/events";
import { handle } from "@/main/lib/ipc-handler";
import { getNotifications } from "@/main/notifications";
import { getUiState } from "@/main/ui-state";
import { readSessionHistory } from "@/main/session-history";
import { registerExecutorIpcHandlers } from "@/main/executor-ipc";
import { registerVaultIpcHandlers } from "@/main/vault-ipc";
import { getVaultManager, setVaultChangeNotifier } from "@/main/vault";
import { isHttpUrl, toErrorMessage } from "@repo/core/ipc";
import { IPC } from "@repo/core/ipc-registry";
import type { UpdateState } from "@repo/core/ipc";

const { autoUpdater } = electronUpdater;

const isDevelopment = !app.isPackaged;
const STARTUP_UPDATE_DELAY_MS = 15_000;
const APP_DISPLAY_NAME = isDevelopment ? "Inteligir (Dev)" : "Inteligir";

let mainWindow: BrowserWindow | null = null;

// ---------------------------------------------------------------------------
// Crash visibility — wire the log mirror and global error hooks before
// anything else can fail, so even startup crashes land in agent.log.
// ---------------------------------------------------------------------------

initAgentLog();

process.on("uncaughtException", (error) => {
  // appendFileSync inside the log mirror means this line is on disk before we
  // continue — an owner debugging a dead install gets the stack.
  console.error("[desktop] uncaught exception:", error);
  // Preserve Electron's default behavior (which our listener suppresses):
  // surface the error dialog and keep the app alive.
  dialog.showErrorBox(
    "A JavaScript error occurred in the main process",
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
});

process.on("unhandledRejection", (reason) => {
  console.error("[desktop] unhandled rejection:", reason);
});

// ---------------------------------------------------------------------------
// Graceful shutdown — the single path every quit trigger funnels through:
// cmd+Q / window close (before-quit), SIGINT/SIGTERM, and the auto-update
// install. Stops the agent + executor daemon (app-machine shutdown) with a
// hard timeout so a hung teardown can't wedge quit. Idempotent: concurrent
// triggers share one promise.
// ---------------------------------------------------------------------------

const SHUTDOWN_TIMEOUT_MS = 5_000;
let shutdownPromise: Promise<void> | null = null;
let shutdownFinished = false;

function runGracefulShutdown(): Promise<void> {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        console.error(
          `[desktop] graceful shutdown timed out after ${SHUTDOWN_TIMEOUT_MS}ms — quitting anyway`,
        );
        resolve();
      }, SHUTDOWN_TIMEOUT_MS);
    });
    try {
      await Promise.race([
        shutdown().catch((error: unknown) => {
          console.error("[desktop] shutdown failed:", error);
        }),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
      shutdownFinished = true;
    }
  })();
  return shutdownPromise;
}

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
  emitEvent("onUpdateState", updateState);
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

// IPC handlers, grouped by domain. registerIpcHandlers() wires them all; each
// group is a small named function so a reader (or reviewer) sees the domain
// boundaries instead of scanning one 150-line block. Handlers reference
// module-level singletons, so the groups take no arguments.
function registerIpcHandlers(): void {
  registerUpdateHandlers();
  registerAgentHandlers();
  registerLifecycleHandlers();
  registerVoiceHandlers();
  registerNotificationHandlers();
  registerUiStateHandlers();
  registerExecutorIpcHandlers();
  registerVaultIpcHandlers();
  registerDelegationHandlers();
  registerSkillAndIntegrationHandlers();
}

function registerDelegationHandlers(): void {
  handle("createDelegation", (params) => getDelegationManager().createDelegation(params));
  handle("listDelegations", () => ({ delegations: getDelegationManager().getDelegations() }));
  handle("cancelDelegation", (id) => getDelegationManager().cancelDelegation(id));
  handle("generateInlineAi", (params) => generateInline(params.prompt, params.requestId));
}

function registerUpdateHandlers(): void {
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
    // Graceful shutdown FIRST: quitAndInstall's internal quit must not be
    // intercepted (preventDefault breaks the install on some platforms), and
    // the executor daemon must not outlive the app across an update. After
    // the shutdown resolves, shutdownFinished lets before-quit pass through.
    const shutdownThenInstall = async (): Promise<void> => {
      await runGracefulShutdown();
      try {
        autoUpdater.quitAndInstall();
      } catch (error: unknown) {
        setUpdateState({ status: "error", message: toErrorMessage(error) });
      }
    };
    setImmediate(() => void shutdownThenInstall());
    return { accepted: true, state: updateState };
  });
}

function registerAgentHandlers(): void {
  // All interactive agent commands funnel through the gateway, which defers
  // them while an external chat turn owns the session (see agent-gateway.ts).
  // Return the submission promise so renderer-side failure surfacing
  // (agent-store's sendCommandSurfacingFailure) sees rejections — e.g.
  // "Agent unavailable" mid-newSession — instead of a silently dropped send.
  handle("sendAgentCommand", (command) => dispatchAgentCommand(command));

  handle("getAgentHistory", () => readSessionHistory());
  handle("reauthenticate", () => reauthenticate());
}

function registerLifecycleHandlers(): void {
  handle("getAppState", () => getAppState());
  handle("transition", (event) => {
    transition(event);
  });
}

function registerVoiceHandlers(): void {
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
        emitEvent("onSttTranscript", ev);
      }
    } catch (err) {
      console.error("[voice] audio chunk handler failed:", err);
    }
  });

  handle("stopStt", () => stopSession());
  handle("getVoiceModelStatus", () => (isModelInstalled() ? "ready" : "missing"));
  handle("downloadVoiceModel", () => downloadModel());
}

function registerNotificationHandlers(): void {
  handle("getNotificationSettings", () => getNotifications().getSettings());
  handle("updateNotificationSettings", (patch) => getNotifications().updateSettings(patch));
}

function registerUiStateHandlers(): void {
  handle("getUiState", () => getUiState().getAll());
  handle("setUiState", ({ key, value }) => {
    getUiState().set(key, value);
  });
}

function registerSkillAndIntegrationHandlers(): void {
  handle("listSkills", () => ({ skills: listSkills() }));

  // Integrations (CLI binaries).
  handle("listIntegrations", () => listIntegrations(getAgentPorts()));
  handle("repairIntegrations", () =>
    repairIntegrations(getAgentPorts(), (p) => emitEvent("onSetupProgress", p)),
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
 * mode). Mirrors the renderer's default-to-light behaviour for unset/invalid.
 */
function startupBackgroundColor(): string {
  const stored = getUiState().getAll()["theme"];
  const theme = stored === "dark" || stored === "system" ? stored : "light";
  const dark = theme === "dark" || (theme === "system" && nativeTheme.shouldUseDarkColors);
  return dark ? "#141415" : "#f0f2f2";
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

  // Renderer crash recovery: log the reason (it lands in agent.log) and
  // reload. Deliberate teardowns aren't crashes; the reload cap stops a
  // crash-on-boot loop from spinning forever.
  let crashReloads = 0;
  window.webContents.on("render-process-gone", (_event, details) => {
    console.error(
      `[desktop] renderer process gone: reason=${details.reason} exitCode=${details.exitCode}`,
    );
    if (details.reason === "clean-exit" || details.reason === "killed") return;
    if (crashReloads >= 3) {
      console.error("[desktop] renderer crashed repeatedly — not reloading again (View > Reload)");
      return;
    }
    crashReloads += 1;
    window.webContents.reload();
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

// Re-drives quit after a graceful shutdown, with an external watchdog.
// Chromium intercepts SIGTERM/SIGINT on its shutdown-detector thread (the
// Node-level signal handlers never fire) and starts its own quit; our
// before-quit preventDefault wedges that signal-initiated quit sequence, and
// the follow-up app.quit() then BLOCKS the main thread indefinitely inside
// Chromium (observed via `sample`: main thread parked in mach_msg deep in
// the quit call, windows and helpers already gone). A blocked JS thread can
// never run a setTimeout fallback, so the watchdog must live outside the
// process: a detached shell that re-signals us. A second SIGTERM is known to
// complete the wedged quit immediately; SIGKILL is the last resort. On a
// normal quit (cmd+Q, auto-update) the process exits in milliseconds and the
// watchdog's signals hit a dead pid — a no-op.
function quitNow(): void {
  console.log("[desktop] graceful shutdown complete — quitting");
  if (process.platform !== "win32") {
    try {
      const watchdog = spawn(
        "/bin/sh",
        [
          "-c",
          `sleep 3; kill -TERM ${process.pid} 2>/dev/null; sleep 5; kill -KILL ${process.pid} 2>/dev/null`,
        ],
        { detached: true, stdio: "ignore" },
      );
      watchdog.unref();
    } catch (error) {
      console.error("[desktop] failed to start quit watchdog:", error);
    }
  }
  app.quit();
}

app.on("before-quit", (event) => {
  if (shutdownFinished) return;
  event.preventDefault();
  void runGracefulShutdown().then(() => quitNow());
});

function onAppReady(): void {
  // Must run before any pi-coding-agent call that consults getAgentDir().
  configurePaths();
  configureAppIdentity();
  configureApplicationMenu();
  configureAutoUpdater();
  registerIpcHandlers();

  // Transport fold: forward every host-emitted event to all renderer windows.
  subscribeEvents((method, payload) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC[method].channel, payload);
      }
    }
  });

  // Vault: ensure the folder + agent symlink exist and stream file changes to
  // the renderer so the Vault panel and bound widgets stay live. The notifier
  // is module-scoped, so it survives a logout/login reset.
  getVaultManager().ensureReady();
  setVaultChangeNotifier((root) => emitEvent("onVaultChanged", { root }));

  mainWindow = createWindow();
  getNotifications().setTargetWindow(mainWindow);

  initMachine();
}

app
  .whenReady()
  .then(onAppReady)
  .catch((error) => {
    console.error("[desktop] fatal startup error", error);
    dialog.showErrorBox("Inteligir failed to start", toErrorMessage(error));
    app.quit();
  });

// POSIX signals must take the same graceful path as before-quit. In practice
// Chromium's shutdown-detector thread usually catches SIGTERM/SIGINT before
// Node does (so these handlers rarely fire and quit arrives via before-quit
// above); they remain as a belt-and-braces path for environments where
// Chromium does not install its detectors.
const handleSignal = (signal: NodeJS.Signals) => {
  console.log(`[desktop] received ${signal} — shutting down`);
  void runGracefulShutdown().then(() => quitNow());
};
process.on("SIGINT", handleSignal);
process.on("SIGTERM", handleSignal);
