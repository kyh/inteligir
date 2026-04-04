// ---------------------------------------------------------------------------
// Agent sidecar worker — spawned by Electron main via child_process.fork()
//
// Owns the pi-coding-agent lifecycle. Accepts text commands over IPC
// immediately. LiveKit voice pipeline starts lazily when main sends
// a "voice-start" message.
// ---------------------------------------------------------------------------

import { voice } from "@livekit/agents";
import * as silero from "@livekit/agents-plugin-silero";
import { Room } from "@livekit/rtc-node";

import { Agent, seedResources } from "@/agent/setup";
import { PiLLMAdapter } from "@/agent/pi-llm-adapter";
import { taskManager } from "@/main/tasks/task-singleton";
import { isRecord } from "@/shared/ipc";
import { TextChatMessageSchema, type TextChatMessage } from "@/shared/voice";

// ---------------------------------------------------------------------------
// Voice pipeline configuration
// ---------------------------------------------------------------------------

const STT_MODEL = "deepgram/nova-3";
const TTS_VOICE = "elevenlabs/eleven_flash_v2_5:SAz9YHcvj6GT2YYXdXww";

// ---------------------------------------------------------------------------
// Agent singleton
// ---------------------------------------------------------------------------

let piAgent: Agent | null = null;
let agentInitPromise: Promise<Agent> | null = null;

async function ensureAgent(): Promise<Agent> {
  if (piAgent) return piAgent;
  if (agentInitPromise) return agentInitPromise;

  agentInitPromise = (async () => {
    seedResources();
    const agent = new Agent();
    await agent.start();
    piAgent = agent;
    return agent;
  })();

  try {
    return await agentInitPromise;
  } catch (err) {
    agentInitPromise = null;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Forward agent events to main process (for renderer chat streaming)
// ---------------------------------------------------------------------------

function forwardToMain(event: unknown): void {
  if (process.send) {
    try {
      process.send({ type: "agent-event", event });
    } catch {
      // Non-cloneable event — skip
    }
  }
}

// ---------------------------------------------------------------------------
// Text command dispatch — shared by IPC and data channel handlers
// ---------------------------------------------------------------------------

function dispatchCommand(agent: Agent, msg: TextChatMessage): void {
  switch (msg.type) {
    case "user_message":
      agent.sendMessage(msg.text).catch((err) => console.error("[worker] sendMessage error:", err));
      break;
    case "steer":
      agent.steer(msg.text).catch((err) => console.error("[worker] steer error:", err));
      break;
    case "interrupt":
      agent.interrupt().catch((err) => console.error("[worker] interrupt error:", err));
      break;
    case "clear":
      agent.clear();
      break;
  }
}

function parseTextCommand(raw: unknown): TextChatMessage | null {
  const result = TextChatMessageSchema.safeParse(raw);
  return result.success ? result.data : null;
}

// ---------------------------------------------------------------------------
// Voice pipeline — lazy lifecycle
// ---------------------------------------------------------------------------

let voiceRoom: Room | null = null;
let voiceSession: voice.AgentSession | null = null;
let vadPromise: Promise<silero.VAD> | null = null;

async function startVoice(agent: Agent, url: string, token: string): Promise<void> {
  if (voiceRoom) {
    console.warn("[worker] voice already active, ignoring voice-start");
    return;
  }

  const vad = await (vadPromise ?? silero.VAD.load());
  const room = new Room();
  voiceRoom = room;

  console.log("[worker] connecting voice to", url);
  await room.connect(url, token);

  const llmAdapter = new PiLLMAdapter(agent);
  const voiceAgent = new voice.Agent({
    instructions: "You are Inteligir, an AI chief of staff. Be concise and helpful.",
    vad,
    stt: STT_MODEL,
    tts: TTS_VOICE,
    llm: llmAdapter,
  });

  const session = new voice.AgentSession({});
  voiceSession = session;

  await session.start({ agent: voiceAgent, room });

  console.log("[worker] voice pipeline started");
}

async function stopVoice(): Promise<void> {
  if (voiceSession) {
    await voiceSession.close();
    voiceSession = null;
  }
  if (voiceRoom) {
    await voiceRoom.disconnect();
    voiceRoom = null;
  }
  console.log("[worker] voice pipeline stopped");
}

// ---------------------------------------------------------------------------
// @livekit/agents logger init — the SDK requires a pino-compatible logger on
// globalThis before any class is instantiated. Normally cli.runApp() handles
// this. We create a thin console-backed shim to avoid importing pino.
// ---------------------------------------------------------------------------

function initAgentsLogger(): void {
  const LOGGER_KEY = Symbol.for("@livekit/agents:logger");
  const LOGGER_OPTIONS_KEY = Symbol.for("@livekit/agents:loggerOptions");
  const g = globalThis as Record<symbol, unknown>;
  if (g[LOGGER_KEY]) return; // already initialized

  // Minimal pino-compatible logger backed by console
  const noop = () => {};
  const levels = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };
  const minLevel = levels.info;

  function makeLogger(name?: string): Record<string, unknown> {
    const prefix = name ? `[${name}] ` : "";
    const logger: Record<string, unknown> = {
      level: "info",
      trace: minLevel <= levels.trace ? (...args: unknown[]) => console.debug(prefix, ...args) : noop,
      debug: minLevel <= levels.debug ? (...args: unknown[]) => console.debug(prefix, ...args) : noop,
      info: (...args: unknown[]) => console.info(prefix, ...args),
      warn: (...args: unknown[]) => console.warn(prefix, ...args),
      error: (...args: unknown[]) => console.error(prefix, ...args),
      fatal: (...args: unknown[]) => console.error(prefix, ...args),
      child: (bindings: Record<string, unknown>) => makeLogger(bindings["name"] as string ?? name),
      isLevelEnabled: (l: string) => (levels[l as keyof typeof levels] ?? 0) >= minLevel,
    };
    return logger;
  }

  g[LOGGER_OPTIONS_KEY] = { pretty: true, level: "info" };
  g[LOGGER_KEY] = makeLogger();
}

// ---------------------------------------------------------------------------
// Main entry — agent first, voice lazy
// ---------------------------------------------------------------------------

// Prevent @livekit/agents internal unhandled rejections from crashing the process.
// The SDK rejects promises with `undefined` during participant disconnect cleanup.
process.on("unhandledRejection", (reason) => {
  if (reason !== undefined) {
    console.error("[worker] unhandled rejection:", reason);
  }
});

async function main(): Promise<void> {
  // 0. Initialize @livekit/agents logger (required before using any agents SDK class).
  // The SDK reads from globalThis via Symbol. Normally cli.runApp() sets this up.
  // We set it directly to avoid importing pino or internal SDK modules.
  initAgentsLogger();

  // 1. Init agent immediately — text chat is ready
  const agent = await ensureAgent();
  agent.subscribe(forwardToMain);
  taskManager.startScheduler(() => piAgent);

  // 2. Preload VAD in background for when voice is needed
  vadPromise = silero.VAD.load();
  vadPromise.catch((err) => console.error("[worker] VAD preload failed:", err));

  // 3. IPC listener — text commands + voice lifecycle
  process.on("message", (msg: unknown) => {
    if (!isRecord(msg) || typeof msg.type !== "string") return;

    switch (msg.type) {
      case "text-command": {
        const command = parseTextCommand(msg.command);
        if (command) dispatchCommand(agent, command);
        break;
      }
      case "voice-start": {
        const url = typeof msg.url === "string" ? msg.url : "";
        const token = typeof msg.token === "string" ? msg.token : "";
        if (url && token) {
          startVoice(agent, url, token).catch((err) => {
            console.error("[worker] voice start failed:", err);
          });
        }
        break;
      }
      case "voice-stop": {
        stopVoice().catch((err) => console.error("[worker] voice stop failed:", err));
        break;
      }
    }
  });

  // 4. Graceful shutdown — clean up voice + browser tab
  async function shutdown(): Promise<void> {
    console.log("[worker] shutting down...");
    taskManager.stopScheduler();
    await stopVoice();
    try {
      const { disposeBrowserTool } = await import("@/agent/browser-tool");
      disposeBrowserTool();
    } catch { /* browser tool may not have been loaded */ }
  }

  process.on("SIGTERM", () => { void shutdown().then(() => process.exit(0)); });
  process.on("SIGINT", () => { void shutdown().then(() => process.exit(0)); });

  // 5. Signal ready to main process
  if (process.send) {
    process.send({ type: "ready" });
  }

  console.log("[worker] agent ready, waiting for commands");
}

// ---------------------------------------------------------------------------
// CLI entry — starts the worker when run as a sidecar
// ---------------------------------------------------------------------------

if (process.argv.includes("start")) {
  main().catch((err) => {
    console.error("[worker] fatal:", err);
    process.exit(1);
  });
}
