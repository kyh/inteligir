// ---------------------------------------------------------------------------
// Sidecar lifecycle + IPC handlers for agent commands and voice
// ---------------------------------------------------------------------------

import path from "node:path";
import fs from "node:fs";
import { exec, fork, type ChildProcess } from "node:child_process";

import { app, BrowserWindow, ipcMain } from "electron";

import { handleSidecarAgentEvent } from "@/main/app-machine";
import { createIpcHandler } from "@/main/lib/ipc-handler";
import { getResolvedSessionFile } from "@/main/session-history";
import { SidecarMessageSchema, parseAgentEvent } from "@/shared/agent-event-parser";
import { IPC_CHANNELS } from "@/shared/ipc";
import { TextChatMessageSchema, type TextChatMessage } from "@/shared/voice";
import { createRoomToken, type LiveKitCredentials } from "./livekit-token";

declare const __LIVEKIT_URL__: string;

const ROOM_NAME = "inteligir-desktop";
const USER_IDENTITY = "desktop-user";
const AGENT_IDENTITY = "desktop-agent";

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

// ---------------------------------------------------------------------------
// Sidecar lifecycle
// ---------------------------------------------------------------------------

export async function ensureSidecar(): Promise<ChildProcess> {
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
  const sessionFile = getResolvedSessionFile();
  console.log("[sidecar] spawning agent worker:", workerPath, "(node:", nodePath + ")");

  const proc = fork(workerPath, ["start"], {
    execPath: nodePath,
    stdio: ["pipe", "inherit", "inherit", "ipc"],
    env: {
      ...process.env,
      LIVEKIT_URL: __LIVEKIT_URL__,
      ...(app.isPackaged
        ? {
            INTELIGIR_RESOURCES_PATH: process.resourcesPath,
            NODE_PATH: [
              path.join(process.resourcesPath, "app.asar", "node_modules"),
              path.join(process.resourcesPath, "app.asar.unpacked", "node_modules"),
              process.env["NODE_PATH"],
            ]
              .filter(Boolean)
              .join(path.delimiter),
          }
        : {}),
      ...(sessionFile ? { INTELIGIR_SESSION_FILE: sessionFile } : {}),
    },
  });

  // Wait for "ready" signal from worker before resolving
  await new Promise<void>((resolve, reject) => {
    const onMessage = (msg: unknown) => {
      if (typeof msg === "object" && msg !== null && (msg as Record<string, unknown>).type === "ready") {
        proc.removeListener("message", onMessage);
        proc.removeListener("exit", onExit);
        resolve();
      }
    };
    const onExit = (code: number | null) => {
      proc.removeListener("message", onMessage);
      reject(new Error(`Sidecar exited during init (code ${String(code)})`));
    };
    proc.on("message", onMessage);
    proc.once("exit", onExit);
  });

  sidecar = proc;

  // Forward agent events to renderer
  proc.on("message", (msg: unknown) => {
    const wrapper = SidecarMessageSchema.safeParse(msg);
    if (!wrapper.success) return;
    const event = parseAgentEvent(wrapper.data.event);
    if (!event) return;
    handleSidecarAgentEvent(event);
    broadcastToRenderer(IPC_CHANNELS.AGENT_EVENT, event);
  });

  proc.on("exit", (code) => {
    console.log(`[sidecar] agent worker exited with code ${String(code)}`);
    sidecar = null;

    if (code !== null && code !== 0) {
      broadcastToRenderer(IPC_CHANNELS.AGENT_EVENT, {
        type: "sidecar_error",
        message: `Agent worker crashed (exit code ${code})`,
      });
    }
  });

  console.log("[sidecar] agent ready");
  return proc;
}

function broadcastToRenderer(channel: string, data: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, data);
    }
  }
}

// ---------------------------------------------------------------------------
// Send commands to sidecar
// ---------------------------------------------------------------------------

export async function sendCommandToSidecar(command: TextChatMessage): Promise<void> {
  const proc = await ensureSidecar();
  proc.send({ type: "text-command", command });
}

async function sendVoiceStart(url: string, token: string): Promise<void> {
  const proc = await ensureSidecar();
  proc.send({ type: "voice-start", url, token });
}

async function sendVoiceStop(): Promise<void> {
  // Only send if sidecar is running — don't spawn one just to stop voice
  if (sidecar && sidecar.exitCode === null) {
    sidecar.send({ type: "voice-stop" });
  }
}

// ---------------------------------------------------------------------------
// Shutdown
// ---------------------------------------------------------------------------

const SIDECAR_SHUTDOWN_TIMEOUT_MS = 5_000;

export async function killSidecar(): Promise<void> {
  const proc = sidecar;
  if (!proc) return;
  sidecar = null;

  if (proc.exitCode !== null) return;

  proc.kill("SIGTERM");

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      console.warn("[sidecar] did not exit in time, force-killing");
      proc.kill("SIGKILL");
      resolve();
    }, SIDECAR_SHUTDOWN_TIMEOUT_MS);

    proc.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// IPC handler registration
// ---------------------------------------------------------------------------

export function registerAgentIpcHandlers(): () => void {
  // Text commands from renderer → sidecar
  createIpcHandler(IPC_CHANNELS.AGENT_COMMAND, TextChatMessageSchema, (command) => {
    void sendCommandToSidecar(command);
  });

  // Voice token request — generates separate tokens for user (renderer) and agent (sidecar)
  ipcMain.handle(IPC_CHANNELS.VOICE_TOKEN, async (): Promise<LiveKitCredentials> => {
    const [userCredentials, agentCredentials] = await Promise.all([
      createRoomToken(ROOM_NAME, USER_IDENTITY),
      createRoomToken(ROOM_NAME, AGENT_IDENTITY, {
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      }),
    ]);
    await sendVoiceStart(agentCredentials.url, agentCredentials.token);
    return userCredentials;
  });

  // Voice stop — renderer tells sidecar to tear down voice pipeline
  ipcMain.handle(IPC_CHANNELS.VOICE_STOP, async () => {
    await sendVoiceStop();
  });

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.AGENT_COMMAND);
    ipcMain.removeHandler(IPC_CHANNELS.VOICE_TOKEN);
    ipcMain.removeHandler(IPC_CHANNELS.VOICE_STOP);
    void killSidecar();
  };
}
