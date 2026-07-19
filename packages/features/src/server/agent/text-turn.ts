// ---------------------------------------------------------------------------
// runTextTurn — the shared core of "run one isolated agent text turn". The same
// subscribe → capture streamed deltas → sendMessage → waitForIdle(timeout) →
// interrupt-on-timeout block was hand-copied across the inline-AI generator,
// intent classifier, ghost-text completer, and delegation runner. This owns
// ONLY the turn mechanics; every caller keeps its own supersession/epoch/queue
// bookkeeping and post-processes the returned text (trim, empty-reply strings,
// parse, staleness/stop guards, custom timeout messages) itself — that's
// exactly where the copies legitimately diverged.
// ---------------------------------------------------------------------------

import { parseAgentEvent } from "@repo/bridge/agent-event-parser";
import { toErrorMessage } from "@repo/bridge/wire-helpers";

/** The subset of the Agent surface one text turn drives. Structural so the real
 * Agent satisfies it and tests can pass a lightweight fake without casts
 * (mirrors DelegationAgent). */
export type TextTurnAgent = {
  subscribe(listener: (event: unknown) => void): () => void;
  sendMessage(message: string): Promise<void>;
  waitForIdle(timeoutMs: number): Promise<boolean>;
  interrupt(): Promise<unknown>;
};

/**
 * Outcome of one turn. Three variants so callers can distinguish the paths the
 * originals treated differently:
 * - `ok`    — the turn went idle; `text` is the captured assistant text, RAW
 *             (untrimmed) — callers trim / parse / empty-check as they see fit.
 * - timeout — waitForIdle elapsed; the turn was interrupted before returning.
 * - error   — sendMessage/waitForIdle threw; `error` is `toErrorMessage(err)`.
 *
 * The timeout/error split matters: delegation's stop-guard applies to timeouts
 * but not throws, and ghost-text counts a turn on timeout but not on a throw.
 * Timeout carries no message — callers supply their own ("Timed out", etc.).
 */
export type TextTurnResult =
  | { ok: true; text: string }
  | { ok: false; kind: "timeout" }
  | { ok: false; kind: "error"; error: string };

export type TextTurnOptions = {
  /** Milliseconds to wait for the agent to go idle before interrupting. */
  timeoutMs: number;
  /** Each assistant text delta (message_update), for live streaming. */
  onDelta?: (delta: string) => void;
  /** Each tool-call start (tool_execution_start), for a live transcript. Only
   * fires for tool-enabled agents — the pure text generators never call it. */
  onToolCall?: (toolName: string) => void;
};

/**
 * Run one isolated agent text turn. Subscribes and captures the streamed
 * assistant text, sends `prompt`, waits for idle (interrupting on timeout), and
 * returns the captured text. Capture mirrors the originals exactly: text deltas
 * accumulate, and a final assistant `message_end` REPLACES the accumulation —
 * so `text` is the complete reply when the model emits one, the streamed
 * fragment otherwise.
 */
export async function runTextTurn(
  agent: TextTurnAgent,
  prompt: string,
  opts: TextTurnOptions,
): Promise<TextTurnResult> {
  let captured = "";
  const unsubscribe = agent.subscribe((raw) => {
    const event = parseAgentEvent(raw);
    if (event?.type === "message_update") {
      captured += event.delta;
      opts.onDelta?.(event.delta);
    } else if (event?.type === "tool_execution_start") {
      opts.onToolCall?.(event.toolName);
    } else if (event?.type === "message_end" && event.role === "assistant" && event.text) {
      captured = event.text;
    }
  });
  try {
    await agent.sendMessage(prompt);
    const finished = await agent.waitForIdle(opts.timeoutMs);
    if (!finished) {
      await agent.interrupt().catch(() => {});
      return { ok: false, kind: "timeout" };
    }
    return { ok: true, text: captured };
  } catch (err) {
    return { ok: false, kind: "error", error: toErrorMessage(err) };
  } finally {
    unsubscribe();
  }
}
