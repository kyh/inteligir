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
import type { ApiClient } from "@repo/server-contract/client";
import { apiErrorResponseSchema } from "@repo/server-contract/errors";
import type { SendMessageRequest, Thread } from "@repo/server-contract/threads";
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

/** Any response the client can hand back: the body is parsed against the error
 *  envelope, so its declared type is whatever that caller's route returns. */
async function refusalMessage<Body>(response: { json(): Promise<Body> }): Promise<string> {
  try {
    const parsed = apiErrorResponseSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.message : "The send was refused.";
  } catch {
    return "The send was refused.";
  }
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

export async function sendToThread(
  api: ApiClient,
  args: SendToThreadArgs,
): Promise<ComposerSendOutcome> {
  const steer = sendRequest(args, "steer-if-active", args.activeTurnId);
  const first = await api.threads.send.$post({ json: steer });
  if (first.ok) {
    return first.json();
  }
  if (first.status !== 409) {
    return { kind: "refused", message: await refusalMessage(first) };
  }
  const refusal = apiErrorResponseSchema.safeParse(await first.json());
  const errorClass = refusal.success ? refusal.data.error : "conflict";
  if (errorClass === "not_steerable") {
    const queued = await api.threads.send.$post({
      json: sendRequest(args, "queue-if-active", null),
    });
    if (queued.ok) {
      return queued.json();
    }
    return { kind: "refused", message: await refusalMessage(queued) };
  }
  if (errorClass === "stale_turn") {
    const detail = await api.threads.get.$get({ query: { threadId: args.threadId } });
    if (!detail.ok) {
      return { kind: "refused", message: await refusalMessage(detail) };
    }
    const { thread } = await detail.json();
    const retry = await api.threads.send.$post({
      json: sendRequest(args, "steer-if-active", thread.activeTurnId),
    });
    if (retry.ok) {
      return retry.json();
    }
    if (retry.status === 409) {
      const queued = await api.threads.send.$post({
        json: sendRequest(args, "queue-if-active", null),
      });
      if (queued.ok) {
        return queued.json();
      }
      return { kind: "refused", message: await refusalMessage(queued) };
    }
    return { kind: "refused", message: await refusalMessage(retry) };
  }
  return {
    kind: "refused",
    message: refusal.success ? refusal.data.message : "The send was refused.",
  };
}

/**
 * The lazy chat thread, SINGLE-FLIGHT. list-then-create is a read followed by
 * a write with no lock between them, so two sends racing the empty state both
 * read "no chat" and both create one — and the loser's thread becomes the
 * designated one the moment its `updatedAt` wins, moving the conversation the
 * user is typing into out from under them. One in-flight promise per session
 * makes the second caller await the first's answer instead of racing it.
 */
export function createChatThreadResolver(api: ApiClient): () => Promise<Thread> {
  let inFlight: Promise<Thread> | null = null;
  return () => {
    if (inFlight !== null) {
      return inFlight;
    }
    const attempt = (async () => {
      const listed = await api.threads.list.$get();
      if (listed.ok) {
        const { threads } = await listed.json();
        const designated = initialChatThread(threads);
        if (designated !== null) {
          return designated;
        }
      }
      const created = await api.threads.create.$post({ json: {} });
      if (!created.ok) {
        throw new Error("Could not create the chat thread");
      }
      return (await created.json()).thread;
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
