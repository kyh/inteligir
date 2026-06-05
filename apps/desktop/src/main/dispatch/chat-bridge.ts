// ---------------------------------------------------------------------------
// Chat bridge — answers `chat_message` envelopes relayed from external
// messaging interfaces (Slack/Telegram/WhatsApp/Discord) via the party room.
//
// Each inbound message is run as one full agent turn and answered with the
// assistant's final text. Turns are serialized through a FIFO queue so two
// conversations (or one conversation sending rapidly) can't interleave and
// cross their replies — `getLastAssistantText()` is only meaningful once the
// turn we started has gone idle.
//
// Note: the agent session is shared with the desktop UI. If the local user is
// mid-turn when a chat message arrives, the message is queued behind them and
// the reply reflects whatever turn was in flight. That's an accepted v1
// limitation of funneling every surface into the single agent session.
// ---------------------------------------------------------------------------

import { getAgent } from "@/main/app-machine";
import { sendChatReply } from "@/main/dispatch/dispatch-client";
import type { ChatMessagePayload } from "@repo/dispatch";

/** Upper bound on a single chat turn. Mirrors the party room's reply timeout
 * so the desktop stops waiting at roughly the same time the gateway does. */
const TURN_TIMEOUT_MS = 120_000;

let queue: Promise<void> = Promise.resolve();

/** Enqueue an inbound chat message. Fire-and-forget — the reply is delivered
 * out of band through `sendChatReply`. */
export function handleChatMessage(payload: ChatMessagePayload): void {
  const { correlationId, text } = payload;
  if (!correlationId || !text.trim()) return;
  const label = payload.conversation?.platform ?? "chat";
  console.log(`[chat-bridge] inbound (${label}) len=${text.length}`);
  queue = queue.then(() => runTurn(correlationId, text)).catch((err) => {
    console.error("[chat-bridge] turn failed:", err);
  });
}

async function runTurn(correlationId: string, text: string): Promise<void> {
  const agent = getAgent();
  if (!agent) {
    sendChatReply(correlationId, "Inteligir isn't ready yet — open the app and finish signing in.");
    return;
  }

  try {
    await agent.sendMessage(text);
    const finished = await agent.waitForIdle(TURN_TIMEOUT_MS);
    if (!finished) {
      sendChatReply(correlationId, "Still working on that — it's taking longer than expected.");
      return;
    }
    const reply = agent.getLastAssistantText();
    sendChatReply(correlationId, reply?.trim() ? reply : "(no response)");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendChatReply(correlationId, `Something went wrong: ${message}`);
  }
}
