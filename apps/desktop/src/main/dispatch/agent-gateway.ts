// ---------------------------------------------------------------------------
// Agent gateway — the single writer to the shared pi agent session.
//
// The agent has several would-be writers: the desktop UI (via the
// `sendAgentCommand` IPC), the mobile remote (via the dispatch relay), widget
// prompts, scheduled tasks, and external chat turns relayed from messaging
// platforms (Slack/Telegram/…). They cannot all poke the agent freely.
//
// Two kinds of access funnel through here:
//
//   1. Exclusive turns — an external chat relay or a scheduled task that needs
//      the session to itself: it sends a prompt and reads back exactly its own
//      assistant text (to relay to the platform, or to summarize the run). It
//      takes the exclusive lock (`beginExclusiveTurn`/`endExclusiveTurn`) for
//      its full duration. Only one runs at a time, and it never starts while
//      another exclusive turn holds the lock (callers check
//      `isExclusiveTurnActive`) or while the user is mid-turn (callers also
//      check the agent isn't already busy).
//
//   2. Interactive commands — desktop UI and mobile relay traffic, routed
//      through `dispatchAgentCommand`. While an exclusive turn owns the lock
//      these queue and flush, in arrival order, when it releases — rather than
//      queuing inside pi as follow-ups/steers/interrupts that would blend into
//      (or abort) the exclusive turn.
// ---------------------------------------------------------------------------

import { getAgent } from "@/main/app-machine";
import type { ImageContent } from "@repo/pi-driver/pi-types";
import type { ImageAttachment, TextChatMessage } from "@/shared/voice";

/** Project IPC ImageAttachment payloads to pi-ai's ImageContent block shape. */
export function toImageContent(images: ImageAttachment[] | undefined): ImageContent[] | undefined {
  return images?.map((i) => ({ type: "image", data: i.data, mimeType: i.mimeType }));
}

let exclusiveTurnActive = false;
let draining = false;

/** A deferred interactive command: the promise handed back to the caller is
 * settled when the command is actually applied, so awaiters (e.g. widget
 * prompts) observe real submission status rather than a premature success. */
type QueuedCommand = {
  command: TextChatMessage;
  resolve: () => void;
  reject: (err: unknown) => void;
};
const queued: QueuedCommand[] = [];

/** Whether an exclusive turn (external chat relay or scheduled task) currently
 * owns the agent session. Would-be exclusive-turn owners must check this — and
 * that the agent isn't already busy — before starting one. */
export function isExclusiveTurnActive(): boolean {
  return exclusiveTurnActive;
}

/** Take the exclusive-turn lock. The caller must have already confirmed no
 * other exclusive turn is active and the agent isn't busy with an interactive
 * turn. Synchronous so it's set before the caller yields. */
export function beginExclusiveTurn(): void {
  exclusiveTurnActive = true;
}

/** Release the exclusive-turn lock and drain any interactive commands that
 * queued while it was held. */
export function endExclusiveTurn(): void {
  exclusiveTurnActive = false;
  void drainQueue();
}

/** Route an interactive command (desktop UI / mobile relay) to the agent.
 * Deferred to the queue while an exclusive turn owns the session, or while a
 * previous batch is still draining, so commands apply one at a time in arrival
 * order. The returned promise settles when the command is actually applied (or
 * fails) — callers that care about agent-side submission errors, e.g. widget
 * prompts surfacing a toast, can await it; fire-and-forget callers ignore it. */
export function dispatchAgentCommand(command: TextChatMessage): Promise<void> {
  if (exclusiveTurnActive || draining) {
    return new Promise<void>((resolve, reject) => {
      queued.push({ command, resolve, reject });
    });
  }
  return apply(command);
}

/** Drain the deferred queue sequentially: apply one command, await its
 * acceptance, then the next. Commands that arrive mid-drain are enqueued (see
 * `dispatchAgentCommand`) and picked up here, so FIFO order holds and no two
 * commands hit the agent concurrently. */
async function drainQueue(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (queued.length > 0) {
      // A new exclusive turn may have begun mid-drain (e.g. a scheduled task
      // fired). Let it run; the remaining queue drains when it ends.
      if (exclusiveTurnActive) break;
      const entry = queued.shift()!;
      try {
        await apply(entry.command);
        entry.resolve();
      } catch (err) {
        entry.reject(err);
      }
    }
  } finally {
    draining = false;
  }
}

async function apply(command: TextChatMessage): Promise<void> {
  const agent = getAgent();
  if (!agent) return;
  switch (command.type) {
    case "user_message":
      await agent.sendMessage(command.text, toImageContent(command.images));
      break;
    case "steer":
      await agent.steer(command.text, toImageContent(command.images));
      break;
    case "follow_up":
      await agent.followUp(command.text, toImageContent(command.images));
      break;
    case "interrupt":
      await agent.interrupt();
      break;
  }
}
