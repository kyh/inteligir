// ---------------------------------------------------------------------------
// Voice IPC — sidecar lifecycle + token generation
// ---------------------------------------------------------------------------

import path from "node:path";
import fs from "node:fs";
import { execSync, fork, type ChildProcess } from "node:child_process";

import { app, BrowserWindow, ipcMain } from "electron";

import { handleSidecarAgentEvent } from "@/main/app-machine";
import { IPC_CHANNELS, isRecord } from "@/shared/ipc";
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
 *
 * On macOS app bundles, PATH is stripped so `which node` may fail.
 * We check well-known install locations as fallback.
 */
function getNodePath(): string {
  if (systemNodePath) return systemNodePath;

  // Try `which node` first (works in dev and most Linux environments)
  try {
    const resolved = execSync("which node", { encoding: "utf8" }).trim();
    if (resolved && fs.existsSync(resolved)) {
      systemNodePath = resolved;
      return systemNodePath;
    }
  } catch {
    // Fall through to well-known paths
  }

  // Well-known Node.js install locations (macOS app bundles strip PATH)
  const candidates = [
    "/usr/local/bin/node",
    "/opt/homebrew/bin/node", // Apple Silicon Homebrew
    "/usr/bin/node",
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      systemNodePath = candidate;
      return systemNodePath;
    }
  }

  throw new Error(
    "Could not find system Node.js binary. Install Node.js or set the NODE_PATH environment variable.",
  );
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
      // Pass Electron-only paths so the system node sidecar can find bundled resources
      ...(app.isPackaged ? { INTELIGIR_RESOURCES_PATH: process.resourcesPath } : {}),
    },
  });

  sidecar.on("message", (msg: unknown) => {
    if (!isRecord(msg)) return;
    if (msg.type === "agent-event") {
      handleSidecarAgentEvent(msg.event);
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

export function killSidecar(): void {
  if (sidecar) {
    sidecar.kill();
    sidecar = null;
  }
}

export function registerLiveKitIpcHandlers(): () => void {
  ipcMain.handle(IPC_CHANNELS.VOICE_TOKEN, async (): Promise<LiveKitCredentials> => {
    ensureSidecar();
    return createRoomToken(ROOM_NAME, USER_IDENTITY);
  });

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.VOICE_TOKEN);
    killSidecar();
  };
}
