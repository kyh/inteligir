// ---------------------------------------------------------------------------
// Agent gateway — the single writer to the shared pi agent session.
//
// The agent has several would-be writers: the desktop UI (via the
// `sendAgentCommand` IPC), the mobile remote (via the dispatch relay), and
// external chat turns relayed from messaging platforms (Slack/Telegram/…).
// They cannot all poke the agent freely: an external chat turn needs the
// session *exclusively* so the chat-bridge can read back exactly its own
// assistant text to relay to the platform. Any interactive command that lands
// mid-turn would otherwise queue inside pi as a follow-up/steer/interrupt and
// blend into — or abort — that turn.
//
// So all access funnels through here. An external chat turn takes an exclusive
// lock for its duration; interactive commands that arrive while the lock is
// held are queued and flushed, in arrival order, when it releases. (An
// external turn only starts if the agent isn't already busy with interactive
// work — the chat-bridge checks that — so the lock never preempts the user.)
// ---------------------------------------------------------------------------

import { getAgent } from "@/main/app-machine";
import type { ImageContent } from "@repo/pi-driver/pi-types";
import type { ImageAttachment, TextChatMessage } from "@/shared/voice";

/** Project IPC ImageAttachment payloads to pi-ai's ImageContent block shape. */
export function toImageContent(images: ImageAttachment[] | undefined): ImageContent[] | undefined {
  return images?.map((i) => ({ type: "image", data: i.data, mimeType: i.mimeType }));
}

let chatTurnActive = false;
const queued: TextChatMessage[] = [];

/** Whether an external chat turn currently owns the agent session. */
export function isChatTurnActive(): boolean {
  return chatTurnActive;
}

/** Take the exclusive chat-turn lock. The caller (chat-bridge) must have
 * already confirmed the agent isn't busy with an interactive turn. */
export function beginChatTurn(): void {
  chatTurnActive = true;
}

/** Release the chat-turn lock and flush interactive commands that queued while
 * it was held, in arrival order. */
export function endChatTurn(): void {
  chatTurnActive = false;
  while (queued.length > 0) {
    apply(queued.shift()!);
  }
}

/** Route an interactive command (desktop UI / mobile relay) to the agent.
 * Deferred to the queue while an external chat turn owns the session. */
export function dispatchAgentCommand(command: TextChatMessage): void {
  if (chatTurnActive) {
    queued.push(command);
    return;
  }
  apply(command);
}

function apply(command: TextChatMessage): void {
  const agent = getAgent();
  if (!agent) return;
  switch (command.type) {
    case "user_message":
      void agent.sendMessage(command.text, toImageContent(command.images));
      break;
    case "steer":
      void agent.steer(command.text, toImageContent(command.images));
      break;
    case "follow_up":
      void agent.followUp(command.text, toImageContent(command.images));
      break;
    case "interrupt":
      void agent.interrupt();
      break;
  }
}
