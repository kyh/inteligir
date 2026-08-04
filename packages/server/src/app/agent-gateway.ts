// ---------------------------------------------------------------------------
// Agent gateway — the single entry point for interactive agent commands.
//
// The user-facing desktop chat is the ONLY writer to the shared pi session, so
// this is a thin typed pass-through with no queue. It exists as a seam anyway:
// the IPC handler never reaches into app-machine directly, and a second writer
// (mobile relay, widget prompt, external chat) gets one obvious place to
// reintroduce serialization instead of racing the session.
//
// It is also where a RETRY is made safe. A remote sender whose socket dies
// mid-request cannot know whether the turn ran, so it re-sends under the same
// `clientId`; delivering it twice would run the message twice. Ids are
// remembered only once the command actually reached the agent — a rejected
// dispatch never happened, and must stay retryable.
// ---------------------------------------------------------------------------

import { getAgent, getAppState } from "./app-machine";
import type { ImageContent } from "@repo/agent/pi/pi-types";
import type { ImageAttachment, TextChatMessage } from "@repo/bridge/chat-message";

/** Project IPC ImageAttachment payloads to pi-ai's ImageContent block shape. */
export function toImageContent(images: ImageAttachment[] | undefined): ImageContent[] | undefined {
  return images?.map((i) => ({ type: "image", data: i.data, mimeType: i.mimeType }));
}

/** How many delivered client ids stay remembered. A retry follows its original
 * by seconds, so this only has to outlive a reconnect — it is a bounded
 * window, deliberately not a set that grows for the process lifetime. */
const DELIVERED_ID_WINDOW = 256;

/** Insertion-ordered, so the oldest id is the one evicted when it overflows. */
const deliveredIds = new Set<string>();

function rememberDelivered(clientId: string): void {
  deliveredIds.add(clientId);
  if (deliveredIds.size <= DELIVERED_ID_WINDOW) return;
  const oldest = deliveredIds.values().next();
  if (!oldest.done) deliveredIds.delete(oldest.value);
}

/** Apply an interactive command to the live agent. The returned promise settles
 * when the command is submitted (or fails) — callers that surface submission
 * errors (e.g. agent-store) await it; fire-and-forget callers ignore it. */
export async function dispatchAgentCommand(command: TextChatMessage): Promise<void> {
  // Commands only reach a READY app. During a RESET/SETUP the old agent stays
  // published until `await agent.stop()` settles inside the effect, so without
  // this phase gate a delayed IPC submit could grab the tearing-down agent and
  // run concurrently with its abort/deletion. The machine flips to
  // "setting_up" BEFORE the effect runs (reducer-first), so the gate covers
  // the whole teardown window.
  if (getAppState().phase !== "ready") throw new Error("Agent unavailable");
  const agent = getAgent();
  // Reject rather than silently resolve: a command arriving while the agent is
  // briefly null (e.g. mid newSession/stopAgent) didn't reach it, so awaiters
  // must not treat it as submitted.
  if (!agent) throw new Error("Agent unavailable");
  // An interrupt carries no id: it is idempotent, so a repeat costs nothing.
  const clientId = command.type === "interrupt" ? undefined : command.clientId;
  if (clientId !== undefined && deliveredIds.has(clientId)) return;
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
  if (clientId !== undefined) rememberDelivered(clientId);
}
