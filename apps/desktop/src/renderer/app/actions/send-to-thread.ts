// The composer's server conversation, framework-free over the typed client.
//
// EVERY SEND STATES WHAT THE VIEW BELIEVES, and the server decides: start the
// turn when the thread is idle, queue the message when it is busy. The view
// names the turn it is watching so a client whose belief is stale is refused
// rather than acted on; the refusal is recoverable, not fatal — re-read the
// thread and send again against what is actually open.
//
// The suites here drive the REAL ThreadService over an in-process app, so the
// whole matrix is proven against the server's own transitions.

import type { ViewContext } from "@repo/domain/view-context";
import type { SendMessageRequest } from "@repo/api/local/threads/threads-schema";
import { isDefinedError, refusalMessage, safe, type client } from "../api";

export type ComposerSendOutcome =
  | { kind: "started"; turnId: string }
  | { kind: "queued"; queuedMessageId: string }
  | { kind: "refused"; message: string };

export interface SendToThreadArgs {
  threadId: string;
  text: string;
  /** The turn the user is watching; the staleness guard the send carries. */
  activeTurnId: string | null;
  /** What the sender was looking at. Carried on the retry too: whether a send
   *  starts or queues is the server's decision, and the server is where a
   *  queued message's context is dropped. */
  viewContext?: ViewContext;
}

/** The sentence shown when the refusal carried none of its own. */
const SEND_REFUSED = "The send was refused.";

/** One send, guarding the turn named. `expectedTurnId` and the view context
 *  are omitted rather than sent empty: the server reads an absent guard as
 *  "this client believes the thread is idle". */
function sendRequest(args: SendToThreadArgs, expectedTurnId: string | null): SendMessageRequest {
  const request: SendMessageRequest = { threadId: args.threadId, text: args.text };
  if (expectedTurnId !== null) {
    request.expectedTurnId = expectedTurnId;
  }
  if (args.viewContext !== undefined) {
    request.viewContext = args.viewContext;
  }
  return request;
}

/**
 * Send, and recover once from a stale guard: the view's belief about the open
 * turn was wrong, so re-read the thread and send again against what is
 * actually open. Bounded to one retry rather than racing a thread that keeps
 * moving.
 */
export async function sendToThread(
  api: typeof client,
  args: SendToThreadArgs,
): Promise<ComposerSendOutcome> {
  const [error, sent] = await safe(api.threads.send(sendRequest(args, args.activeTurnId)));
  if (sent !== undefined) {
    return sent;
  }
  if (isDefinedError(error) && error.code === "STALE_TURN") {
    const [detailError, detail] = await safe(api.threads.get({ threadId: args.threadId }));
    if (detail === undefined) {
      return { kind: "refused", message: refusalMessage(detailError, SEND_REFUSED) };
    }
    const [retryError, retried] = await safe(
      api.threads.send(sendRequest(args, detail.thread.activeTurnId)),
    );
    if (retried !== undefined) {
      return retried;
    }
    return { kind: "refused", message: refusalMessage(retryError, SEND_REFUSED) };
  }
  return { kind: "refused", message: refusalMessage(error, SEND_REFUSED) };
}
