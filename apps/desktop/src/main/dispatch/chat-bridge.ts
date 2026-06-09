// ---------------------------------------------------------------------------
// Chat bridge — answers `chat_message` envelopes relayed from external
// messaging interfaces (Slack/Telegram/WhatsApp/Discord) via the party room.
//
// One turn at a time. The agent session is shared with the desktop UI, so we
// run a single chat turn at a time and reject (with an immediate "busy" reply)
// any message that arrives while a chat turn is in flight OR while the session
// is already busy with a desktop-initiated turn. This keeps the gateway request
// short and prevents one conversation's answer from leaking into another's.
//
// The reply text is captured from THIS turn's agent events (the assistant
// `message_end`), not `getLastAssistantText()` — which returns the *previous*
// turn's text after an early abort. Errors surface via `message_end`
// stopReason/`turn_error` because pi swallows prompt failures asynchronously
// and they never reach a try/catch here.
//
// Every inbound message with a correlationId is always answered with exactly
// one `chat_reply`, so the gateway never blocks for the full timeout.
// ---------------------------------------------------------------------------

import { getAgent } from "@/main/app-machine";
import {
  beginExclusiveTurn,
  endExclusiveTurn,
  isAgentReserved,
} from "@/main/dispatch/agent-gateway";
import { sendChatReply } from "@/main/dispatch/dispatch-client";
import { parseAgentEvent } from "@/shared/agent-event-parser";
import { toErrorMessage } from "@/shared/ipc";
import type { ChatMessagePayload } from "@repo/dispatch";

/** Upper bound on a single chat turn before we abort it. Kept below the party
 * room's reply timeout so the gateway is still listening when we answer. */
const TURN_TIMEOUT_MS = 120_000;
/** Grace period for the session to settle after an interrupt. */
const DRAIN_TIMEOUT_MS = 5_000;

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

  // The agent is reserved — another exclusive turn (chat relay / scheduled
  // task) holds it, or the gateway is still draining queued interactive
  // commands. Reply busy rather than starting a turn that would interleave.
  if (isAgentReserved()) {
    sendChatReply(
      correlationId,
      "I'm busy finishing something up — I'll be free in a moment, then resend.",
    );
    return;
  }

  const label = payload.conversation?.platform ?? "chat";
  console.log(`[chat-bridge] inbound (${label}) len=${text.length}`);

  // Take the exclusive agent lock for this turn; interactive commands (desktop
  // UI / mobile) that arrive meanwhile queue in the gateway and flush on
  // release, so they can't blend into the reply we relay back.
  beginExclusiveTurn();
  void runTurn(correlationId, text).finally(() => {
    endExclusiveTurn();
  });
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function runTurn(correlationId: string, text: string): Promise<void> {
  const agent = getAgent();
  if (!agent) {
    sendChatReply(correlationId, "Inteligir isn't ready yet — open the app and finish signing in.");
    return;
  }

  // Don't attach to a turn the desktop user already started — its assistant
  // text isn't ours to relay. Ask the sender to retry shortly.
  if (agent.getState().status === "busy") {
    sendChatReply(correlationId, "Inteligir is busy with another task right now — try again shortly.");
    return;
  }

  // Capture this turn's result from the event stream. Subscribe BEFORE sending
  // so we can't miss the assistant message or agent_end.
  let assistantText = "";
  let errorMessage: string | null = null;
  let sawToolCall = false;
  let resolveEnd: () => void;
  const ended = new Promise<void>((resolve) => {
    resolveEnd = resolve;
  });

  const unsubscribe = agent.subscribe((raw) => {
    const event = parseAgentEvent(raw);
    if (!event) return;
    switch (event.type) {
      case "tool_execution_start":
        sawToolCall = true;
        break;
      case "message_end":
        if (event.role === "assistant") {
          if (event.text) assistantText = event.text;
          if (event.stopReason === "error") {
            errorMessage = event.errorMessage ?? "the model returned an error";
          }
        }
        break;
      case "agent_end":
        resolveEnd();
        break;
    }
  });

  try {
    await agent.sendMessage(text);
    const finished = await Promise.race([
      ended.then(() => true),
      delay(TURN_TIMEOUT_MS).then(() => false),
    ]);

    if (!finished) {
      // Abort the runaway turn before releasing the slot, otherwise the next
      // message's sendMessage would land mid-turn as a follow-up.
      await agent.interrupt().catch(() => {});
      await Promise.race([ended, delay(DRAIN_TIMEOUT_MS)]);
      sendChatReply(correlationId, "That's taking longer than expected — I've stopped it. Try again.");
      return;
    }

    if (errorMessage) {
      sendChatReply(correlationId, `The agent hit an error: ${errorMessage}`);
      return;
    }
    if (assistantText.trim()) {
      sendChatReply(correlationId, assistantText);
      return;
    }
    // No assistant text and no tool call ≈ an upstream/auth failure pi swallowed
    // as success (mirrors app-machine's synthetic turn_error). Surface it rather
    // than a bare "(no response)".
    if (!sawToolCall) {
      sendChatReply(
        correlationId,
        "The model returned no response — the upstream call may have failed. Make sure Inteligir is authenticated, then try again.",
      );
      return;
    }
    sendChatReply(correlationId, "(no response)");
  } catch (err) {
    sendChatReply(correlationId, `Something went wrong: ${toErrorMessage(err)}`);
  } finally {
    unsubscribe();
  }
}
