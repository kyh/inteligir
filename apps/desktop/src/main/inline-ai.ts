// ---------------------------------------------------------------------------
// Inline-AI generator — a third, dedicated Agent for the editor's inline AI
// (continue writing / summarize / improve). It runs on its own session
// (INLINE_AI_SESSION_DIR) with a HARD empty tool allowlist, so it's a pure text
// generator: no file tools, no executor, no chance of it wandering off editing
// the vault. Its turns never touch the user's chat thread.
//
// Requests are serialized (one at a time); the caller sends a fully-formed
// prompt and gets back the assistant's final text.
// ---------------------------------------------------------------------------

import { Agent } from "@/agent/agent";
import { INLINE_AI_SESSION_DIR } from "@/agent/paths";
import { getAgentPorts } from "@/main/lib/agent-lifecycle";
import { parseAgentEvent } from "@repo/core/agent-event-parser";
import type { AiGenerateResult } from "@repo/core/inline-ai";

const GEN_TIMEOUT_MS = 60_000;

let agent: Agent | null = null;
let busy = false;

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
    const text = captured.trim();
    return text.length > 0 ? { ok: true, text } : { ok: false, error: "No response." };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "AI request failed." };
  } finally {
    unsubscribe();
    busy = false;
  }
}
