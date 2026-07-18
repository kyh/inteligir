// ---------------------------------------------------------------------------
// Ghost-text generator — a dedicated FAST Agent for copilot-style inline
// completions. Differs from the inline-AI session on every axis that matters
// for a per-typing-pause feature:
//   - fast model (settings override via ui-state, default = cheapest tier)
//   - ephemeral in-memory session (nothing on disk, nothing resumable)
//   - supersede semantics: a new request aborts the in-flight one, so the
//     queue never builds up behind a stale completion
//   - periodic recycle: the in-memory thread is thrown away every
//     RECYCLE_AFTER_TURNS turns so accumulated context can't degrade latency
// Started lazily on the first request — the feature is opt-in, so most
// launches never pay for it.
// ---------------------------------------------------------------------------

import { toErrorMessage } from "@repo/features/ipc";

import { Agent } from "../agent/agent";
import {
  getSelectedProvider,
  listSelectedProviderModels,
  resolveModelForSelectedProvider,
} from "../provider/provider-service";
import { getAgentPorts } from "../lib/agent-lifecycle";
import { getUiState } from "../ui-state";
import { runTextTurn } from "./text-turn";
import {
  GHOST_TEXT_MODEL_UI_STATE,
  type GhostModelsResult,
  type GhostTextResult,
} from "@repo/features/inline-ai";

const GHOST_TIMEOUT_MS = 20_000;
const RECYCLE_AFTER_TURNS = 24;

let agent: Agent | null = null;
// Cache key covers provider AND model: a Settings provider switch must not
// reuse an agent whose model id happens to collide across providers.
let agentModelKey: string | null = null;
let turns = 0;
let currentRequestId: string | null = null;
// Serializes runs; supersession happens by aborting the current turn so the
// chain drains fast, never by concurrent sends into one session.
let queue: Promise<unknown> = Promise.resolve();

/** Models the ghost session can run — the SELECTED provider's registry — for
 * the settings picker. */
export function listGhostModels(): GhostModelsResult {
  const models = listSelectedProviderModels().map((m) => ({ id: m.id, label: m.name }));
  return { models, defaultId: defaultGhostModelId() };
}

/** The fastest tier in the selected provider's registry: prefer an explicit
 * low-latency ("spark") model, then the cheapest by output cost — price
 * tracks model size, and size tracks latency. Null only if the registry is
 * empty. */
function defaultGhostModelId(): string | null {
  const models = listSelectedProviderModels();
  if (models.length === 0) return null;
  const spark = models.find((m) => m.id.includes("spark"));
  if (spark) return spark.id;
  const cheapest = models.toSorted((a, b) => a.cost.output - b.cost.output)[0];
  return cheapest ? cheapest.id : null;
}

/** The model the next request should run: the settings override when it names
 * a model of the SELECTED provider (a stale override from a previous provider
 * misses and falls through), else the default fast tier. */
function resolveGhostModelId(): string | null {
  const stored = getUiState().getAll()[GHOST_TEXT_MODEL_UI_STATE];
  if (typeof stored === "string" && listSelectedProviderModels().some((m) => m.id === stored)) {
    return stored;
  }
  return defaultGhostModelId();
}

export async function stopGhostAgent(): Promise<void> {
  const a = agent;
  agent = null;
  agentModelKey = null;
  turns = 0;
  currentRequestId = null;
  if (a) await a.stop().catch(() => {});
}

/** (Re)create the agent when missing, when the configured provider/model
 * changed, or when the in-memory thread is due for a recycle. */
async function ensureAgent(): Promise<Agent | null> {
  const modelId = resolveGhostModelId();
  if (modelId === null) return null;
  const modelKey = `${getSelectedProvider().provider}/${modelId}`;
  if (agent && agentModelKey === modelKey && turns < RECYCLE_AFTER_TURNS) return agent;
  await stopGhostAgent();
  const next = new Agent({
    ports: getAgentPorts(),
    ephemeralSession: true,
    allowedToolNames: [], // pure text completer — no tools at all
    resolveModel: () => resolveModelForSelectedProvider(modelId),
  });
  await next.start();
  agent = next;
  agentModelKey = modelKey;
  return next;
}

/** One ghost completion. A newer request supersedes this one: the in-flight
 * turn is aborted and the superseded caller gets `{ ok: false }`. */
export function generateGhost(prompt: string, requestId: string): Promise<GhostTextResult> {
  // Abort whatever is running so the queue drains fast for this request.
  void interruptCurrent();
  const run = queue.then(() => runGhost(prompt, requestId));
  queue = run.catch(() => {});
  return run;
}

/** Abort the in-flight completion if `requestId` still identifies it (the
 * renderer canceled: user typed / Escape / blur). Stale ids are a no-op. */
export async function cancelGhost(requestId: string): Promise<void> {
  if (currentRequestId !== requestId) return;
  await interruptCurrent();
}

async function interruptCurrent(): Promise<void> {
  if (currentRequestId === null) return;
  currentRequestId = null;
  await agent?.interrupt().catch(() => {});
}

async function runGhost(prompt: string, requestId: string): Promise<GhostTextResult> {
  let a: Agent | null;
  try {
    a = await ensureAgent();
  } catch (err) {
    return { ok: false, error: toErrorMessage(err, "Ghost text failed.") };
  }
  if (!a) return { ok: false, error: "No ghost-text model is available." };
  currentRequestId = requestId;
  try {
    const result = await runTextTurn(a, prompt, { timeoutMs: GHOST_TIMEOUT_MS });
    // A turn counts toward the recycle budget once it reaches idle or times out,
    // but not when the send itself threw (matching the original placement of the
    // increment right after waitForIdle).
    if (result.ok || result.kind === "timeout") turns += 1;
    if (!result.ok) {
      return {
        ok: false,
        error: result.kind === "timeout" ? "Ghost text timed out." : result.error,
      };
    }
    // Canceled or superseded mid-turn — the caller's completion is stale.
    if (currentRequestId !== requestId) return { ok: false, error: "Canceled." };
    const text = result.text.trim();
    return text.length > 0 ? { ok: true, text } : { ok: false, error: "No completion." };
  } finally {
    if (currentRequestId === requestId) currentRequestId = null;
  }
}
