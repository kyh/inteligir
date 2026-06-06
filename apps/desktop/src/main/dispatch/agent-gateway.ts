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
const queued: TextChatMessage[] = [];

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

/** Release the exclusive-turn lock and flush interactive commands that queued
 * while it was held, in arrival order. */
export function endExclusiveTurn(): void {
  exclusiveTurnActive = false;
  while (queued.length > 0) {
    void apply(queued.shift()!).catch(() => {});
  }
}

/** Route an interactive command (desktop UI / mobile relay) to the agent.
 * Deferred to the queue while an exclusive turn owns the session; otherwise
 * applied immediately. The returned promise resolves once the command has been
 * accepted (or immediately, if queued) so callers that care about agent-side
 * submission errors — e.g. widget prompts surfacing a toast — can await it. */
export function dispatchAgentCommand(command: TextChatMessage): Promise<void> {
  if (exclusiveTurnActive) {
    queued.push(command);
    return Promise.resolve();
  }
  return apply(command);
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
