// The composer's server conversation, framework-free over the typed client.
//
// EVERY SEND STATES WHAT THE VIEW BELIEVES, and the server decides. A steer
// carries the turn id the user is watching; a send from a view that believes
// the thread is idle carries none, which the server reads as "this client has
// not seen the running turn" and refuses — so text can never land in a turn
// the user never saw. The refusal is recoverable, not fatal: re-read the
// thread, and steer the turn that is actually open or fall back to the queue.
//
// The suites here drive the REAL ThreadService over an in-process app, so the
// whole matrix is proven against the server's own transitions.

import type { ViewContext } from "@repo/domain/view-context";
import type { SendMessageRequest, Thread } from "@repo/api/local/threads/threads-schema";
import { isDefinedError, refusalMessage, safe, type client } from "../api";
import { initialChatThread } from "./chat-model";

export type ComposerSendOutcome =
  | { kind: "started"; turnId: string }
  | { kind: "steered"; turnId: string }
  | { kind: "queued"; queuedMessageId: string }
  | { kind: "refused"; message: string };

export interface SendToThreadArgs {
  threadId: string;
  text: string;
  /** The turn the user is watching; the staleness guard on a steer. */
  activeTurnId: string | null;
  /** What the sender was looking at. Carried on EVERY attempt below, the
   *  queue fallbacks included: which mode a send lands in is the server's
   *  decision, and the server is where a queued message's context is dropped. */
  viewContext?: ViewContext;
}

/** The sentence shown when the refusal carried none of its own. */
const SEND_REFUSED = "The send was refused.";

/** One send, in the mode named, guarding the turn named. `expectedTurnId` and
 *  the view context are omitted rather than sent empty: the server reads an
 *  absent guard as "this client believes the thread is idle". */
function sendRequest(
  args: SendToThreadArgs,
  mode: SendMessageRequest["mode"],
  expectedTurnId: string | null,
): SendMessageRequest {
  const request: SendMessageRequest = { threadId: args.threadId, text: args.text, mode };
  if (expectedTurnId !== null) {
    request.expectedTurnId = expectedTurnId;
  }
  if (args.viewContext !== undefined) {
    request.viewContext = args.viewContext;
  }
  return request;
}

/** The fallback for a thread that can take neither a steer nor a start: the
 *  message waits for the running turn to settle rather than being lost. */
async function queueSend(api: typeof client, args: SendToThreadArgs): Promise<ComposerSendOutcome> {
  const [error, queued] = await safe(api.threads.send(sendRequest(args, "queue-if-active", null)));
  if (queued !== undefined) {
    return queued;
  }
  return { kind: "refused", message: refusalMessage(error, SEND_REFUSED) };
}

/**
 * Steer when a turn is running, start when idle, queue when the thread can
 * take neither (starting/stopping, or a provider that refuses the steer).
 *
 * The stale-turn branch is the recovery for the guard above: the view's belief
 * was wrong, so re-read the thread and act on what is actually open. The retry
 * is bounded to one — it re-reads once and then queues rather than racing a
 * thread that keeps moving.
 */
export async function sendToThread(
  api: typeof client,
  args: SendToThreadArgs,
): Promise<ComposerSendOutcome> {
  const [error, sent] = await safe(
    api.threads.send(sendRequest(args, "steer-if-active", args.activeTurnId)),
  );
  if (sent !== undefined) {
    return sent;
  }
  if (isDefinedError(error) && error.code === "NOT_STEERABLE") {
    return queueSend(api, args);
  }
  if (isDefinedError(error) && error.code === "STALE_TURN") {
    const [detailError, detail] = await safe(api.threads.get({ threadId: args.threadId }));
    if (detail === undefined) {
      return { kind: "refused", message: refusalMessage(detailError, SEND_REFUSED) };
    }
    const [retryError, retried] = await safe(
      api.threads.send(sendRequest(args, "steer-if-active", detail.thread.activeTurnId)),
    );
    if (retried !== undefined) {
      return retried;
    }
    if (
      isDefinedError(retryError) &&
      (retryError.code === "STALE_TURN" || retryError.code === "NOT_STEERABLE")
    ) {
      return queueSend(api, args);
    }
    return { kind: "refused", message: refusalMessage(retryError, SEND_REFUSED) };
  }
  return { kind: "refused", message: refusalMessage(error, SEND_REFUSED) };
}

/**
 * The lazy chat thread, SINGLE-FLIGHT. list-then-create is a read followed by
 * a write with no lock between them, so two sends racing the empty state both
 * read "no chat" and both create one — and the loser's thread becomes the
 * designated one the moment its `updatedAt` wins, moving the conversation the
 * user is typing into out from under them. One in-flight promise per session
 * makes the second caller await the first's answer instead of racing it.
 */
export function createChatThreadResolver(api: typeof client): () => Promise<Thread> {
  let inFlight: Promise<Thread> | null = null;
  return () => {
    if (inFlight !== null) {
      return inFlight;
    }
    const attempt = (async () => {
      const [, listed] = await safe(api.threads.list());
      if (listed !== undefined) {
        const designated = initialChatThread(listed.threads);
        if (designated !== null) {
          return designated;
        }
      }
      const [, created] = await safe(api.threads.create({}));
      if (created === undefined) {
        throw new Error("Could not create the chat thread");
      }
      return created.thread;
    })();
    inFlight = attempt;
    // A FAILED attempt must not be cached: the next send retries.
    void attempt.catch(() => {
      if (inFlight === attempt) {
        inFlight = null;
      }
    });
    return attempt;
  };
}
