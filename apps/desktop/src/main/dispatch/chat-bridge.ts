// ---------------------------------------------------------------------------
// Chat bridge — answers `chat_message` envelopes relayed from external
// messaging interfaces (Slack/Telegram/WhatsApp/Discord) via the party room.
//
// One turn at a time. The agent session is shared with the desktop UI and
// `getLastAssistantText()` is only meaningful for the turn we started, so we
// run a single chat turn at a time. A message that arrives while a turn is in
// flight gets an immediate "busy" reply rather than being queued — this keeps
// the gateway's request short (no waiting past its timeout for a turn that
// hasn't started) and avoids cross-attributing replies between conversations.
//
// Every inbound message with a correlationId is always answered with exactly
// one `chat_reply`, so the gateway never blocks for the full timeout waiting on
// a reply that isn't coming.
// ---------------------------------------------------------------------------

import { getAgent } from "@/main/app-machine";
import { sendChatReply } from "@/main/dispatch/dispatch-client";
import type { ChatMessagePayload } from "@repo/dispatch";

/** Upper bound on a single chat turn before we abort it. Kept below the party
 * room's reply timeout so the gateway is still listening when we answer. */
const TURN_TIMEOUT_MS = 120_000;
/** Grace period for the session to settle after an interrupt. */
const DRAIN_TIMEOUT_MS = 5_000;

let active = false;

/** Handle an inbound chat message. Always replies exactly once (via
 * `sendChatReply`) so the gateway request resolves promptly. */
export function handleChatMessage(payload: ChatMessagePayload): void {
  const { correlationId, text } = payload;
  // No correlationId means nothing can consume the reply — drop it.
  if (!correlationId) return;

  if (!text.trim()) {
    sendChatReply(correlationId, "I didn't catch a message there — try again.");
    return;
  }

  if (active) {
    sendChatReply(
      correlationId,
      "I'm still working on your previous message — I'll be free in a moment, then resend.",
    );
    return;
  }

  const label = payload.conversation?.platform ?? "chat";
  console.log(`[chat-bridge] inbound (${label}) len=${text.length}`);

  active = true;
  void runTurn(correlationId, text).finally(() => {
    active = false;
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
      // Abort the runaway turn before releasing the slot, otherwise the next
      // message's sendMessage would land mid-turn as a follow-up and its reply
      // would be attributed to the wrong correlationId.
      await agent.interrupt().catch(() => {});
      await agent.waitForIdle(DRAIN_TIMEOUT_MS);
      sendChatReply(correlationId, "That's taking longer than expected — I've stopped it. Try again.");
      return;
    }
    const reply = agent.getLastAssistantText();
    sendChatReply(correlationId, reply?.trim() ? reply : "(no response)");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendChatReply(correlationId, `Something went wrong: ${message}`);
  }
}
