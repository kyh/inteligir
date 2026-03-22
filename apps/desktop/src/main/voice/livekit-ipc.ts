// ---------------------------------------------------------------------------
// Voice IPC — sidecar lifecycle + token generation
// ---------------------------------------------------------------------------

import path from "node:path";
import fs from "node:fs";
import { exec, fork, type ChildProcess } from "node:child_process";

import { app, BrowserWindow, ipcMain } from "electron";

import { handleSidecarAgentEvent } from "@/main/app-machine";
import { IPC_CHANNELS, isRecord } from "@/shared/ipc";
import { createRoomToken, type LiveKitCredentials } from "./livekit-token";

declare const __LIVEKIT_URL__: string;

const ROOM_NAME = "inteligir-desktop";
const USER_IDENTITY = "desktop-user";

let sidecar: ChildProcess | null = null;
let sidecarPromise: Promise<ChildProcess> | null = null;
let systemNodePath: string | null = null;
let nodePathPromise: Promise<string> | null = null;

function getWorkerPath(): string {
  return path.join(__dirname, "worker.js");
}

/**
 * Resolve the system Node.js binary path (async to avoid blocking the main process).
 * We must NOT use Electron's binary — it bundles Chromium's WebRTC which
 * conflicts with @livekit/rtc-node's native WebRTC (duplicate ObjC classes).
 *
 * On macOS app bundles, PATH is stripped so `which node` may fail.
 * We check well-known install locations as fallback.
 */
async function resolveNodePath(): Promise<string> {
  if (systemNodePath) return systemNodePath;

  // 1. Check NODE_PATH env var first (as the error message advertises)
  const envPath = process.env["NODE_PATH"];
  if (envPath && fs.existsSync(envPath)) {
    systemNodePath = envPath;
    return systemNodePath;
  }

  // 2. Try `which node` / `where node` (async to avoid blocking the main thread)
  const whichCmd = process.platform === "win32" ? "where node" : "which node";
  try {
    const resolved = await new Promise<string>((resolve, reject) => {
      exec(whichCmd, { encoding: "utf8" }, (err, stdout) => {
        if (err) return reject(err);
        resolve(stdout.trim().split("\n")[0] ?? "");
      });
    });
    if (resolved && fs.existsSync(resolved)) {
      systemNodePath = resolved;
      return systemNodePath;
    }
  } catch {
    // Fall through to well-known paths
  }

  // 3. Well-known Node.js install locations (macOS app bundles strip PATH)
  const candidates =
    process.platform === "win32"
      ? [
          path.join(process.env["ProgramFiles"] ?? "C:\\Program Files", "nodejs", "node.exe"),
          path.join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "nodejs", "node.exe"),
        ]
      : [
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

/** Pre-resolve system Node.js path during startup so it's cached before first use. */
export function warmupNodePath(): void {
  if (!nodePathPromise) {
    nodePathPromise = resolveNodePath();
    nodePathPromise.catch((err) => {
      console.error("[voice] failed to resolve system Node.js:", err);
    });
  }
}

async function ensureSidecar(): Promise<ChildProcess> {
  if (sidecar && sidecar.exitCode === null) return sidecar;
  if (sidecarPromise) return sidecarPromise;

  sidecarPromise = spawnSidecar();
  try {
    return await sidecarPromise;
  } finally {
    sidecarPromise = null;
  }
}

async function spawnSidecar(): Promise<ChildProcess> {
  const workerPath = getWorkerPath();
  const nodePath = await (nodePathPromise ?? resolveNodePath());
  console.log("[voice] spawning agent worker:", workerPath, "(node:", nodePath + ")");

  sidecar = fork(workerPath, ["start"], {
    execPath: nodePath,
    stdio: ["pipe", "inherit", "inherit", "ipc"],
    env: {
      ...process.env,
      // __LIVEKIT_URL__ is a build-time constant from electron.vite.config.ts.
      // API key/secret are on process.env via process.loadEnvFile() at runtime.
      LIVEKIT_URL: __LIVEKIT_URL__,
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

const SIDECAR_SHUTDOWN_TIMEOUT_MS = 5_000;

/**
 * Gracefully shut down the sidecar. Sends SIGTERM and waits up to 5s for
 * a clean exit before force-killing. Returns a promise that resolves once
 * the process is gone.
 */
export async function killSidecar(): Promise<void> {
  const proc = sidecar;
  if (!proc) return;
  sidecar = null;

  // Already exited?
  if (proc.exitCode !== null) return;

  proc.kill("SIGTERM");

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      console.warn("[voice] sidecar did not exit in time, force-killing");
      proc.kill("SIGKILL");
      resolve();
    }, SIDECAR_SHUTDOWN_TIMEOUT_MS);

    proc.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export function registerLiveKitIpcHandlers(): () => void {
  ipcMain.handle(IPC_CHANNELS.VOICE_TOKEN, async (): Promise<LiveKitCredentials> => {
    await ensureSidecar();
    return createRoomToken(ROOM_NAME, USER_IDENTITY);
  });

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.VOICE_TOKEN);
    void killSidecar();
  };
}
