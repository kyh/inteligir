// ---------------------------------------------------------------------------
// LiveKit agent worker — sidecar process spawned by Electron main
//
// Runs as a child_process.fork(). Connects to LiveKit Cloud, handles
// VAD → STT → pi-agent → TTS voice pipeline and data channel text chat.
// ---------------------------------------------------------------------------

import { fileURLToPath } from "node:url";
import { cli, defineAgent, ServerOptions, voice, type JobContext, type JobProcess } from "@livekit/agents";
import * as silero from "@livekit/agents-plugin-silero";

import { Agent, seedResources } from "@/agent/setup";
import { PiLLMAdapter } from "@/agent/pi-llm-adapter";
import { TaskScheduler } from "@/main/tasks/task-scheduler";
import { isRecord } from "@/shared/ipc";
import { TEXT_CHAT_TOPIC, type TextChatMessage } from "@/shared/voice";

// ---------------------------------------------------------------------------
// Voice pipeline configuration
// ---------------------------------------------------------------------------

const STT_MODEL = "deepgram/flux-general";
const TTS_VOICE = "elevenlabs/eleven_flash_v2_5:SAz9YHcvj6GT2YYXdXww";

// Pre-loaded VAD model — populated in prewarm, reused in entry
let preloadedVAD: silero.VAD | null = null;

// Task scheduler — started once the agent is ready
let taskScheduler: TaskScheduler | null = null;

// ---------------------------------------------------------------------------
// Agent singleton — shared across jobs (single user, single desktop)
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
// Data channel protocol for text chat
// ---------------------------------------------------------------------------

const textDecoder = new TextDecoder();

function parseTextChat(data: Uint8Array): TextChatMessage | null {
  try {
    const str = textDecoder.decode(data);
    const parsed: unknown = JSON.parse(str);
    if (!isRecord(parsed) || typeof parsed.type !== "string") return null;
    switch (parsed.type) {
      case "user_message":
      case "steer":
        return typeof parsed.text === "string" ? { type: parsed.type, text: parsed.text } : null;
      case "interrupt":
        return { type: "interrupt" };
      case "clear":
        return { type: "clear" };
      default:
        return null;
    }
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Forward agent events to main process (for renderer chat streaming)
// ---------------------------------------------------------------------------

function forwardToMain(event: unknown): void {
  if (process.send) {
    try {
      // process.send() uses structured clone — no need to pre-serialize
      process.send({ type: "agent-event", event });
    } catch {
      // Non-cloneable event — skip
    }
  }
}

// ---------------------------------------------------------------------------
// Agent definition
// ---------------------------------------------------------------------------

export default defineAgent({
  prewarm: async (_proc: JobProcess) => {
    preloadedVAD = await silero.VAD.load();
  },

  entry: async (ctx: JobContext) => {
    await ctx.connect();
    const participant = await ctx.waitForParticipant();
    console.log(`[agent-worker] participant joined: ${participant.identity}`);

    const agent = await ensureAgent();
    const llmAdapter = new PiLLMAdapter(agent);

    // Start task scheduler once agent is ready
    if (!taskScheduler) {
      taskScheduler = new TaskScheduler(() => piAgent);
      taskScheduler.start();
    }

    // Forward agent session events to main process
    const unsubEvents = agent.subscribe(forwardToMain);

    // Create voice pipeline agent using LiveKit Cloud inference (no separate API key needed)
    const voiceAgent = new voice.Agent({
      instructions: "You are Inteligir, an AI chief of staff. Be concise and helpful.",
      vad: preloadedVAD ?? await silero.VAD.load(),
      stt: STT_MODEL,
      tts: TTS_VOICE,
      llm: llmAdapter,
    });

    const session = new voice.AgentSession({});

    await session.start({
      agent: voiceAgent,
      room: ctx.room,
    });

    // Listen for text chat via data channel
    ctx.room.on("dataReceived", (payload: Uint8Array, remoteParticipant, _kind, topic) => {
      if (topic !== TEXT_CHAT_TOPIC) return;
      if (remoteParticipant?.identity !== participant.identity) return;

      const msg = parseTextChat(payload);
      if (!msg) return;

      switch (msg.type) {
        case "user_message":
          void agent.sendMessage(msg.text);
          break;
        case "steer":
          void agent.steer(msg.text);
          break;
        case "interrupt":
          void agent.interrupt();
          break;
        case "clear":
          agent.clear();
          break;
      }
    });

    ctx.addShutdownCallback(async () => {
      taskScheduler?.stop();
      taskScheduler = null;
      unsubEvents();
      await session.close();
    });
  },
});

// ---------------------------------------------------------------------------
// CLI entry — starts the worker when run as a sidecar
// ---------------------------------------------------------------------------

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  cli.runApp(new ServerOptions({
    agent: fileURLToPath(import.meta.url),
    numIdleProcesses: 0,
    port: 0, // random port — avoids conflicts on restart
  }));
}
