// ---------------------------------------------------------------------------
// Simplified voice IPC — token generation + sidecar lifecycle
// ---------------------------------------------------------------------------

import path from "node:path";
import { execSync, fork, type ChildProcess } from "node:child_process";

import { app, BrowserWindow, ipcMain } from "electron";

import { handleSidecarAgentEvent } from "@/main/app-machine";
import { IPC_CHANNELS, isRecord, toErrorMessage } from "@/shared/ipc";
import { createRoomToken, type LiveKitCredentials } from "./livekit-token";

const ROOM_NAME = "inteligir-desktop";
const USER_IDENTITY = "desktop-user";

let sidecar: ChildProcess | null = null;
let systemNodePath: string | null = null;

function getWorkerPath(): string {
  return path.join(__dirname, "worker.js");
}

/**
 * Resolve the system Node.js binary path.
 * We must NOT use Electron's binary — it bundles Chromium's WebRTC which
 * conflicts with @livekit/rtc-node's native WebRTC (duplicate ObjC classes).
 */
function getNodePath(): string {
  if (systemNodePath) return systemNodePath;
  try {
    systemNodePath = execSync("which node", { encoding: "utf8" }).trim();
  } catch {
    systemNodePath = "node";
  }
  return systemNodePath;
}

function ensureSidecar(): ChildProcess {
  if (sidecar && sidecar.exitCode === null) return sidecar;

  const workerPath = getWorkerPath();
  const nodePath = getNodePath();
  console.log("[voice] spawning agent worker:", workerPath, "(node:", nodePath + ")");

  sidecar = fork(workerPath, ["start"], {
    execPath: nodePath,
    stdio: ["pipe", "inherit", "inherit", "ipc"],
    env: {
      ...process.env,
      // Vite `define` inlines these at build time so they're not on the
      // runtime process.env object — forward them explicitly to the sidecar.
      LIVEKIT_URL: process.env["LIVEKIT_URL"],
      LIVEKIT_API_KEY: process.env["LIVEKIT_API_KEY"],
      LIVEKIT_API_SECRET: process.env["LIVEKIT_API_SECRET"],
      INTELIGIR_PACKAGED: String(app.isPackaged),
    },
  });

  sidecar.on("message", (msg: unknown) => {
    if (!isRecord(msg)) return;
    if (msg.type === "agent-event") {
      // Forward to app-machine for busy/idle state tracking
      handleSidecarAgentEvent(msg.event);
      // Forward to renderer for chat streaming
      broadcastToRenderer(IPC_CHANNELS.AGENT_EVENT, msg.event);
    }
  });

  sidecar.on("exit", (code) => {
    console.log(`[voice] agent worker exited with code ${String(code)}`);
    sidecar = null;
  });

  return sidecar;
}

function broadcastToRenderer(channel: string, data: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, data);
    }
  }
}

export function registerLiveKitIpcHandlers(): () => void {
  ipcMain.handle(IPC_CHANNELS.VOICE_START, async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      ensureSidecar();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: toErrorMessage(err) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.VOICE_STOP, (): { ok: boolean } => {
    // Don't kill sidecar — it stays alive for text chat too.
    // The renderer disconnects from the room which stops voice.
    return { ok: true };
  });

  ipcMain.handle(IPC_CHANNELS.VOICE_TOKEN, async (): Promise<LiveKitCredentials> => {
    ensureSidecar();
    return createRoomToken(ROOM_NAME, USER_IDENTITY);
  });

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.VOICE_START);
    ipcMain.removeHandler(IPC_CHANNELS.VOICE_STOP);
    ipcMain.removeHandler(IPC_CHANNELS.VOICE_TOKEN);

    if (sidecar) {
      sidecar.kill();
      sidecar = null;
    }
  };
}
