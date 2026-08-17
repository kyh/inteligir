// The composer's server conversation, framework-free over the typed client:
// steer-first sending with the queue fallback, the lazy chat-thread create,
// and the whole delegation create (anchor mint -> thread create -> marker
// insert -> composed first send). Tested against the REAL ThreadService over
// an in-process app, so the send-mode matrix here is proven against the
// server's own transitions, not a mock of them.

import type { ApiClient } from "@repo/server-contract/client";
import { apiErrorResponseSchema } from "@repo/server-contract/routes";
import type { SendMessageRequest, Thread } from "@repo/server-contract/threads";
import {
  composeDelegationMessage,
  delegationTitle,
  designatedChatThread,
  newAnchorToken,
  type DelegationIntent,
} from "./chat-model";

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
}

async function refusalMessage(response: { json(): Promise<unknown> }): Promise<string> {
  try {
    const parsed = apiErrorResponseSchema.loose().safeParse(await response.json());
    return parsed.success ? parsed.data.message : "The send was refused.";
  } catch {
    return "The send was refused.";
  }
}

/**
 * Steer when a turn is running, start when idle, queue when the thread is in
 * a state that can take neither (starting/stopping, or a provider that
 * refuses the steer). One stale-turn retry with the server's fresh turn id —
 * the timeline is live over the socket, so the user has seen the newer turn
 * by the time the retry lands.
 */
export async function sendToThread(
  api: ApiClient,
  args: SendToThreadArgs,
): Promise<ComposerSendOutcome> {
  const steer: SendMessageRequest = {
    threadId: args.threadId,
    text: args.text,
    mode: "steer-if-active",
    ...(args.activeTurnId === null ? {} : { expectedTurnId: args.activeTurnId }),
  };
  const first = await api.threads.send.$post({ json: steer });
  if (first.ok) {
    return first.json();
  }
  if (first.status !== 409) {
    return { kind: "refused", message: await refusalMessage(first) };
  }
  const refusal = apiErrorResponseSchema.loose().safeParse(await first.json());
  const errorClass = refusal.success ? refusal.data.error : "conflict";
  if (errorClass === "not_steerable") {
    const queued = await api.threads.send.$post({
      json: { threadId: args.threadId, text: args.text, mode: "queue-if-active" },
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
      json: {
        threadId: args.threadId,
        text: args.text,
        mode: "steer-if-active",
        ...(thread.activeTurnId === null ? {} : { expectedTurnId: thread.activeTurnId }),
      },
    });
    if (retry.ok) {
      return retry.json();
    }
    if (retry.status === 409) {
      const queued = await api.threads.send.$post({
        json: { threadId: args.threadId, text: args.text, mode: "queue-if-active" },
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

/** The lazy chat thread: the designated one, minted on first need. */
export async function ensureChatThread(api: ApiClient): Promise<Thread> {
  const listed = await api.threads.list.$get();
  if (listed.ok) {
    const { threads } = await listed.json();
    const designated = designatedChatThread(threads);
    if (designated !== null) {
      return designated;
    }
  }
  const created = await api.threads.create.$post({ json: {} });
  if (!created.ok) {
    throw new Error("Could not create the chat thread");
  }
  return (await created.json()).thread;
}

export interface CreateDelegationArgs {
  intent: DelegationIntent;
  docPath: string;
  selectionText: string;
  prompt: string;
  /** Splices the marker into the live buffer (the normal CAS save persists
   *  it); false when the buffer is gone — the thread still runs, chipless. */
  insertAnchor: (anchor: string) => boolean;
}

export interface CreatedDelegation {
  threadId: string;
  anchor: string;
  anchored: boolean;
  send: ComposerSendOutcome;
}

export async function createDelegation(
  api: ApiClient,
  args: CreateDelegationArgs,
): Promise<CreatedDelegation> {
  const anchor = newAnchorToken();
  const created = await api.threads.create.$post({
    json: {
      title: delegationTitle(args.prompt),
      originDocPath: args.docPath,
      originAnchor: anchor,
    },
  });
  if (!created.ok) {
    throw new Error("Could not create the delegation thread");
  }
  const { thread } = await created.json();
  const anchored = args.insertAnchor(anchor);
  const send = await sendToThread(api, {
    threadId: thread.id,
    text: composeDelegationMessage({
      intent: args.intent,
      docPath: args.docPath,
      anchor,
      selectionText: args.selectionText,
      prompt: args.prompt,
    }),
    activeTurnId: null,
  });
  return { threadId: thread.id, anchor, anchored, send };
}
