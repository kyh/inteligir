// ---------------------------------------------------------------------------
// App state machine — serialized async queue, injectable deps + broadcast.
// ---------------------------------------------------------------------------

import { Agent } from "@repo/agent/agent";
import {
  loadUserAgentInstructions,
  seedUserAgentInstructions,
} from "../agent-instructions/agent-instructions";
import { agentModelSelection } from "../provider/provider-service";
import { isSetupComplete } from "@repo/agent/setup";
import { getExecutorDaemon } from "@repo/connectors/executor-daemon";
import { reduce } from "./app-reducer";
import { runEffect, type EffectDeps } from "./app-effects";
import {
  getAgentPorts,
  loginAgent,
  seedAgentResources,
  teardownAgentResources,
} from "../boot/agent-wiring";
import { resumeVaultWrites } from "@repo/vault/vault";
import { hardenAppDir } from "@repo/storage/harden-app-dir";
import { SESSION_DIR_SEGMENTS } from "@repo/agent/paths";
import { emitEvent } from "../events";
import {
  getBackgroundAgent,
  startBackgroundAgent,
  stopBackgroundAgent,
} from "../delegation/background-agent";
import { stopGhostAgent } from "./ghost-text";
import { startInlineAiAgent, stopInlineAiAgent } from "./inline-ai";
import { getDelegationManager } from "../delegation/delegation-manager";
import { getRoutinesManager } from "../routines/routines-manager";
import { getNotifications } from "../notifications";
import { parseAgentEvent } from "@repo/bridge/agent-event-parser";
import type { AppAgentEvent } from "@repo/bridge/agent-events";
import type { AppState, MachineEvent } from "@repo/bridge/app-state";
import { toErrorMessage } from "@repo/bridge/wire-helpers";

// ---------------------------------------------------------------------------
// Agent singleton — runs in the main process
// ---------------------------------------------------------------------------

let agent: Agent | null = null;

// Mutable per-turn scratchpad. `assistantText` is tracked directly because
// session.getLastAssistantText() returns the *previous* turn's text after an
// early abort. The flags drive the empty-turn detection below.
type Turn = {
  startedAt: number;
  assistantText: string | null;
  sawAssistantText: boolean;
  sawToolCall: boolean;
  sawError: boolean;
};
let turn: Turn | null = null;

function startTurn(): void {
  turn = {
    startedAt: Date.now(),
    assistantText: null,
    sawAssistantText: false,
    sawToolCall: false,
    sawError: false,
  };
}

/** Compact, single-line dump of an agent event for the dev terminal. Pretty-
 * printing every field would flood the log; we keep just the discriminators
 * and the few fields needed to triage "what did the LLM actually do?". */
function logAgentEvent(event: AppAgentEvent): void {
  const dt = turn ? `+${Date.now() - turn.startedAt}ms` : "";
  switch (event.type) {
    case "agent_start":
      console.log(`[agent-event] agent_start`);
      break;
    case "agent_end":
      console.log(`[agent-event] agent_end ${dt}`);
      break;
    case "message_start":
      console.log(`[agent-event] message_start role=${event.role} ${dt}`);
      break;
    case "message_end": {
      const text = event.text ?? "";
      const preview = text.length > 80 ? `${text.slice(0, 80)}…` : text;
      console.log(
        `[agent-event] message_end role=${event.role} stop=${event.stopReason ?? "?"} len=${text.length} ${dt} ${preview ? `text="${preview}"` : ""}`.trim(),
      );
      break;
    }
    case "tool_execution_start":
      console.log(`[agent-event] tool_execution_start name=${event.toolName} ${dt}`);
      break;
    case "tool_execution_end":
      console.log(
        `[agent-event] tool_execution_end ok=${!event.isError} len=${event.resultText.length} ${dt}`,
      );
      break;
    case "turn_error":
      console.log(`[agent-event] turn_error kind=${event.kind} reason="${event.reason}" ${dt}`);
      break;
    default:
      console.log(`[agent-event] ${event.type} ${dt}`);
  }
}

function handleAgentEvent(event: AppAgentEvent): void {
  logAgentEvent(event);

  if (event.type === "message_end" && event.stopReason === "error") {
    console.error("[agent] error event:", event);
  }

  switch (event.type) {
    case "agent_start":
      startTurn();
      machine?.ingest({ type: "AGENT_START" });
      break;
    case "tool_execution_start":
      if (turn) turn.sawToolCall = true;
      break;
    case "message_end":
      if (turn && event.role === "assistant") {
        if (event.text) {
          turn.assistantText = event.text;
          turn.sawAssistantText = true;
        }
        if (event.stopReason === "error") turn.sawError = true;
      }
      break;
    case "agent_end": {
      // Empty-turn fallback: pi finished a turn without producing any
      // assistant text, any tool call, or an explicit stopReason: "error".
      // Almost always an upstream/auth failure swallowed as a success.
      if (turn && !turn.sawAssistantText && !turn.sawToolCall && !turn.sawError) {
        const elapsed = Date.now() - turn.startedAt;
        console.warn(
          `[agent] empty turn — no assistant text and no tool calls (took ${elapsed}ms). ` +
            "Likely an upstream LLM/auth failure swallowed as success. " +
            "Check provider auth, model id, and pi-ai output handling.",
        );
        const reason =
          "The model returned no response. The upstream call may have failed silently — try re-authenticating.";
        const errorEvent = {
          type: "turn_error",
          kind: "auth",
          reason,
        } satisfies AppAgentEvent;
        emitEvent("onAgentEvent", errorEvent);
      }
      machine?.ingest({ type: "AGENT_END" });
      getNotifications().notifyAgentIdle(turn?.assistantText ?? undefined);
      turn = null;
      break;
    }
  }

  emitEvent("onAgentEvent", event);
}

async function startAgent(opts: { newSession?: boolean } = {}): Promise<void> {
  if (agent) return;
  // First-use skeleton for vault/AGENTS.md — BEFORE the sessions construct,
  // so the freshly seeded instructions load into this very session. Once per
  // vault, no clobber, non-fatal (agent-instructions.ts).
  seedUserAgentInstructions();
  const next = new Agent({
    ...opts,
    ports: getAgentPorts(),
    selectModel: agentModelSelection,
    userInstructions: loadUserAgentInstructions,
  });
  // Start the dedicated background delegation agent concurrently — it shares no
  // session state with the user agent and the executor daemon's start() is
  // idempotent under concurrency. Non-fatal: a background failure must not block
  // the user agent; delegations just stay queued until it's available.
  const bgStarted = startBackgroundAgent().catch((err: unknown) => {
    console.error("[machine] background delegation agent failed to start:", err);
  });
  // Inline-AI generator — same rationale (isolated session, non-fatal on failure;
  // inline AI just returns "unavailable" until it's up).
  const inlineAiStarted = startInlineAiAgent().catch((err: unknown) => {
    console.error("[machine] inline-ai agent failed to start:", err);
  });
  try {
    await next.start();
    next.subscribe((raw) => {
      const event = parseAgentEvent(raw);
      if (event) handleAgentEvent(event);
    });
  } catch (err) {
    // Don't leave a half-constructed Agent in the singleton — a retry's
    // `if (agent) return` would skip the rest of setup and the machine would
    // transition to ready with a non-functional agent. Tear down the (possibly
    // started) background agent too.
    await next.stop().catch(() => {});
    await bgStarted;
    await stopBackgroundAgent();
    await inlineAiStarted;
    await stopInlineAiAgent();
    throw err;
  }
  agent = next;
  // Settle the background start before returning, then wire it to the delegation
  // queue so any delegations queued before the agent was ready start draining.
  // If it failed to start, mark delegation unavailable so queued/new tasks fail
  // with feedback instead of sitting "Queued" forever behind a null runner.
  await bgStarted;
  const delegations = getDelegationManager();
  // Routines share the background session (serialized against delegation via
  // the shared BackgroundTurnLock) — wired to the same runner, and its boot
  // scheduler starts here (setRunner runs the launch catch-up tick).
  const routines = getRoutinesManager();
  if (getBackgroundAgent()) {
    delegations.setRunner(() => getBackgroundAgent());
    routines.setRunner(() => getBackgroundAgent());
  } else {
    delegations.markUnavailable(
      "The background agent isn't available — restart the app to delegate tasks.",
    );
    routines.markUnavailable(
      "The background agent isn't available — restart the app to run routines.",
    );
  }
}

async function stopAgent(): Promise<void> {
  getDelegationManager().stop();
  getRoutinesManager().stop();
  if (agent) {
    await agent.stop();
    agent = null;
  }
  // Stop all agents before the shared executor daemon: the daemon is a process
  // singleton every session uses, so it must outlive each agent's teardown.
  await stopBackgroundAgent();
  await stopInlineAiAgent();
  // Lazily started (first ghost request), unconditionally stopped.
  await stopGhostAgent();
  await getExecutorDaemon().stop();
  turn = null;
}

async function newSession(): Promise<void> {
  await stopAgent();
  await startAgent({ newSession: true });
}

export function getAgent(): Agent | null {
  return agent;
}

/**
 * Re-run the provider OAuth flow and restart the session so the next turn
 * uses fresh credentials. Runs through the AppMachine's serialized queue so
 * a concurrent SETUP/RESET can't race with the reauth's stopAgent +
 * startAgent. Used by the "Re-authenticate" Settings affordance and the
 * empty-turn modal.
 */
export async function reauthenticate(): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!machine) return { ok: false, error: "Machine not initialized" };
  return machine.enqueueAsync(async () => {
    try {
      await loginAgent();
      await newSession();
      return { ok: true };
    } catch (err) {
      const message = toErrorMessage(err);
      console.error("[machine] reauthenticate failed:", message);
      return { ok: false, error: message };
    }
  });
}

/**
 * Roll the agent sessions so the NEXT turn resolves the newly selected
 * provider+model (Settings → AI switch/connect). Resumes the current thread —
 * unlike reauthenticate's newSession, nothing about the conversation is
 * invalid, only the model serving it. Serialized through the machine queue
 * like reauthenticate; a no-op unless the app is ready (a pre-ready selection
 * change is picked up by the normal SETUP path).
 */
export async function applySelectedProviderChange(): Promise<void> {
  const m = machine;
  if (!m) return;
  await m.enqueueAsync(async () => {
    if (m.getState().phase !== "ready") return;
    await stopAgent();
    await startAgent();
  });
}

// ---------------------------------------------------------------------------
// AppMachine class
// ---------------------------------------------------------------------------

export type Broadcast = (state: AppState) => void;

export class AppMachine {
  private state: AppState;
  private queue: Promise<void> = Promise.resolve();
  private destroying = false;

  constructor(
    private readonly deps: EffectDeps,
    private readonly broadcastState: Broadcast,
    initial: AppState = { phase: "starting" },
  ) {
    this.state = initial;
  }

  getState(): AppState {
    return this.state;
  }

  /** Awaitable — resolves after the triggered effect (if any) completes. */
  send(event: MachineEvent): Promise<void> {
    const p = this.queue.then(() => this.step(event));
    this.queue = p.catch(() => {});
    return p;
  }

  /** Non-awaitable enqueue — for callers that cannot await. */
  ingest(event: MachineEvent): void {
    void this.send(event);
  }

  /**
   * Run an async block through the same FIFO queue as send(). Lets external
   * lifecycle actions (e.g. reauthenticate) interleave safely with state
   * machine events instead of mutating the agent singleton in parallel.
   */
  enqueueAsync<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.queue.then(fn);
    // Swallow the value on the chain copy so a thrown reauth doesn't poison
    // subsequent events; the caller still sees the throw via the returned p.
    this.queue = p.then(
      () => undefined,
      () => undefined,
    );
    return p;
  }

  async shutdown(): Promise<void> {
    this.destroying = true;
    // `this.deps.stopAgent`, NOT the module-level `stopAgent` — every other
    // effect in this class routes through the injected deps, and reaching past
    // them here made shutdown() touch the real host singletons under test:
    // getDelegationManager() then read (and REWROTE) the developer's actual
    // ~/.inteligir/delegations.json, flipping live `running` records to
    // `failed`. `realDeps` below wires the same module-level function, so
    // production behaviour is unchanged. Same leak class documented in
    // create-host-boot.test.ts's header.
    await this.deps.stopAgent();
  }

  private async step(event: MachineEvent): Promise<void> {
    if (this.destroying) return;

    const result = reduce(this.state, event);
    if (result === null) return;

    const prev = this.state;
    this.state = result.next;
    console.log(`[machine] ${prev.phase} -> ${this.state.phase}`);
    this.broadcastState(this.state);

    if (result.effect !== null) {
      const completion = await runEffect(result.effect, this.deps);
      if (this.destroying) return;
      await this.step(completion);
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton instance — wired to real deps and Electron broadcast
// ---------------------------------------------------------------------------

let machine: AppMachine | null = null;

function broadcastAppState(state: AppState): void {
  emitEvent("onAppState", state);
}

const realDeps: EffectDeps = {
  seedResources: seedAgentResources,
  startAgent,
  stopAgent,
  teardownResources: teardownAgentResources,
  resumeVaultWrites,
  rehardenAppDir: () => hardenAppDir(SESSION_DIR_SEGMENTS),
  newSession,
  reportSetupProgress: (progress) => emitEvent("onSetupProgress", progress),
};

export function getAppState(): AppState {
  return machine?.getState() ?? { phase: "starting" };
}

export function transition(event: MachineEvent): void {
  machine?.ingest(event);
}

/** Boot the machine in "starting" and auto-fire SETUP on a warm boot. A guest
 * boots straight toward the workspace regardless of provider/account state —
 * only a genuine FIRST RUN (workspace not yet seeded) lingers in "starting"
 * until the onboarding surface fires SETUP, so the renderer is connected to
 * watch the seeding progress. The delegation + inline-AI push channels are no
 * longer wired here — they emit straight to the typed event bus at their
 * firing sites. */
export function initMachine(): void {
  machine = new AppMachine(realDeps, broadcastAppState, { phase: "starting" });

  if (isSetupComplete()) {
    void machine.send({ type: "SETUP" }).catch((err) => {
      console.error("[machine] init setup failed:", err);
    });
  } else {
    broadcastAppState(machine.getState());
  }
}

export async function shutdown(): Promise<void> {
  console.log("[machine] shutdown");
  await machine?.shutdown();
}
