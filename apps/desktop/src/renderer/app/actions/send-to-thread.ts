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
  activeTurnId: string | null;
  // carried on the retry too: start-vs-queue is the server's call, and it drops a queued message's context.
  viewContext?: ViewContext;
}

const SEND_REFUSED = "The send was refused.";

// omitted rather than sent empty: the server reads an absent guard as "this client believes the thread is idle".
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

// one retry on a stale guard, rather than racing a thread that keeps moving.
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
