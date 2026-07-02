// ---------------------------------------------------------------------------
// Inline-AI generator — a third, dedicated Agent for the editor's inline AI
// (the AI menu's generate/edit flows + intent classification). It runs on its
// own session (INLINE_AI_SESSION_DIR) with a HARD empty tool allowlist, so
// it's a pure text generator: no file tools, no executor, no chance of it
// wandering off editing the vault. Its turns never touch the user's chat
// thread.
//
// Requests are serialized (one at a time); the caller sends a fully-formed
// prompt and gets back the assistant's final text.
// ---------------------------------------------------------------------------

import { Agent } from "../agent/agent";
import { INLINE_AI_SESSION_DIR } from "../agent/paths";
import { getAgentPorts } from "../lib/agent-lifecycle";
import { parseAgentEvent } from "@repo/core/agent-event-parser";
import { parseAiIntent, type AiGenerateResult, type AiIntentResult } from "@repo/core/inline-ai";

const GEN_TIMEOUT_MS = 60_000;
const CLASSIFY_TIMEOUT_MS = 15_000;

let agent: Agent | null = null;
let busy = false;
// requestId of the in-flight generation, so cancelInline can target it. The
// classification turn deliberately never sets this — it's short and there is
// nothing renderer-side to unwind.
let currentRequestId: string | null = null;

// Streaming channel — pushes each text delta (keyed by requestId) so the editor
// can insert the generation live. Wired from app-machine to stay electron-free.
let streamNotifier: ((requestId: string, delta: string) => void) | null = null;

export function setInlineAiStreamNotifier(
  notifier: ((requestId: string, delta: string) => void) | null,
): void {
  streamNotifier = notifier;
}

export async function startInlineAiAgent(): Promise<void> {
  if (agent) return;
  const next = new Agent({
    newSession: true,
    sessionDir: INLINE_AI_SESSION_DIR,
    ports: getAgentPorts(),
    allowedToolNames: [], // pure text generator — no tools at all
  });
  await next.start();
  agent = next;
}

export async function stopInlineAiAgent(): Promise<void> {
  const a = agent;
  if (!a) return;
  agent = null;
  await a.stop().catch(() => {});
}

/** Run one generation. `prompt` is fully formed by the caller (action + text);
 * text deltas stream out via the notifier keyed by `requestId`. */
export async function generateInline(prompt: string, requestId: string): Promise<AiGenerateResult> {
  if (!agent) return { ok: false, error: "AI isn't available — restart the app." };
  if (busy) return { ok: false, error: "Another AI request is already running." };
  busy = true;
  currentRequestId = requestId;
  let captured = "";
  const unsubscribe = agent.subscribe((raw) => {
    const event = parseAgentEvent(raw);
    if (event?.type === "message_update") {
      captured += event.delta;
      streamNotifier?.(requestId, event.delta);
    } else if (event?.type === "message_end" && event.role === "assistant" && event.text) {
      captured = event.text;
    }
  });
  try {
    await agent.sendMessage(prompt);
    const finished = await agent.waitForIdle(GEN_TIMEOUT_MS);
    if (!finished) {
      await agent.interrupt().catch(() => {});
      return { ok: false, error: "The AI request timed out." };
    }
    // Canceled mid-stream: the renderer already unwound its inserts; report
    // failure so no caller mistakes the truncated text for a completion.
    if (currentRequestId !== requestId) return { ok: false, error: "Canceled." };
    const text = captured.trim();
    return text.length > 0 ? { ok: true, text } : { ok: false, error: "No response." };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "AI request failed." };
  } finally {
    unsubscribe();
    busy = false;
    if (currentRequestId === requestId) currentRequestId = null;
  }
}

/** Abort the in-flight generation if `requestId` still identifies it (Escape
 * mid-stream). A stale id is a no-op — the turn already finished. */
export async function cancelInline(requestId: string): Promise<void> {
  if (currentRequestId !== requestId) return;
  currentRequestId = null;
  await agent?.interrupt().catch(() => {});
}

// Kept terse and rigidly formatted — the response is machine-parsed. The
// fallback (parseAiIntent) resolves anything off-script to "generate".
function buildClassifyPrompt(prompt: string, hasSelection: boolean): string {
  return [
    "You are an intent classifier for a notes editor's AI command input.",
    "Classify the user's request as exactly one of two intents:",
    '- "edit": the request asks to CHANGE existing text (rewrite, fix, improve, shorten, lengthen, translate, change tone, reformat).',
    '- "generate": the request asks to PRODUCE new text (continue, write, draft, summarize into a new passage, explain, brainstorm, answer a question).',
    hasSelection
      ? "The user has text selected in the editor."
      : "The user has NO selection — just a cursor position.",
    "Reply with ONLY the single word edit or generate. No punctuation, no explanation.",
    "",
    `User request: ${prompt}`,
  ].join("\n");
}

/** Classify a free-form AI-menu prompt as generate vs edit. Failures of any
 * kind (agent down, busy, timeout, unparseable reply) fall back to generate —
 * the non-destructive branch. */
export async function classifyIntent(
  prompt: string,
  hasSelection: boolean,
): Promise<AiIntentResult> {
  const fallback: AiIntentResult = { intent: "generate" };
  if (!agent || busy) return fallback;
  busy = true;
  let captured = "";
  const unsubscribe = agent.subscribe((raw) => {
    const event = parseAgentEvent(raw);
    if (event?.type === "message_end" && event.role === "assistant" && event.text) {
      captured = event.text;
    }
  });
  try {
    await agent.sendMessage(buildClassifyPrompt(prompt, hasSelection));
    const finished = await agent.waitForIdle(CLASSIFY_TIMEOUT_MS);
    if (!finished) {
      await agent.interrupt().catch(() => {});
      return fallback;
    }
    return { intent: parseAiIntent(captured) };
  } catch {
    return fallback;
  } finally {
    unsubscribe();
    busy = false;
  }
}
