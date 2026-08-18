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

import type { AgentWriteMode } from "@repo/domain/agent-write-mode";
import type { ViewContext } from "@repo/domain/view-context";
import type { ApiClient } from "@repo/server-contract/client";
import { apiErrorResponseSchema } from "@repo/server-contract/errors";
import type { SendMessageRequest, Thread } from "@repo/server-contract/threads";
import {
  composeDelegationMessage,
  delegationTitle,
  initialChatThread,
  newAnchorToken,
  type AnchorFailure,
  type AnchorOutcome,
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
  /** What the sender was looking at. Carried on EVERY attempt below, the
   *  queue fallbacks included: which mode a send lands in is the server's
   *  decision, and the server is where a queued message's context is dropped. */
  viewContext?: ViewContext;
}

async function refusalMessage(response: { json(): Promise<unknown> }): Promise<string> {
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
export async function sendToThread(
  api: ApiClient,
  args: SendToThreadArgs,
): Promise<ComposerSendOutcome> {
  const context = args.viewContext === undefined ? {} : { viewContext: args.viewContext };
  const steer: SendMessageRequest = {
    threadId: args.threadId,
    text: args.text,
    mode: "steer-if-active",
    ...(args.activeTurnId === null ? {} : { expectedTurnId: args.activeTurnId }),
    ...context,
  };
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
      json: { threadId: args.threadId, text: args.text, mode: "queue-if-active", ...context },
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
        ...context,
      },
    });
    if (retry.ok) {
      return retry.json();
    }
    if (retry.status === 409) {
      const queued = await api.threads.send.$post({
        json: { threadId: args.threadId, text: args.text, mode: "queue-if-active", ...context },
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

export interface CreateDelegationArgs {
  intent: DelegationIntent;
  writeMode: AgentWriteMode;
  docPath: string;
  selectionText: string;
  prompt: string;
  /** Splices the marker AND makes it durable; see DelegationDraft.anchor. */
  anchor: (anchor: string) => Promise<AnchorOutcome>;
}

export type CreateDelegationResult =
  | { kind: "created"; threadId: string; anchor: string; send: ComposerSendOutcome }
  | { kind: "not-anchored"; reason: AnchorFailure };

/**
 * THE ORDER IS THE CONTRACT: anchor and flush FIRST, create the thread only
 * once those bytes are durable, and start the turn last.
 *
 * Creating first is what the obvious reading of "mint a thread, then mark the
 * doc" gives you, and it is wrong twice over. The agent materializes the vault
 * from disk, so a turn started before the flush can read the doc WITHOUT the
 * anchor it is told to work at. And an anchor that never lands — the save 409s,
 * the tab closes, the user hits undo — leaves a thread bound to a doc nothing
 * marks: a delegation with no chip, invisible except in the thread list.
 */
export async function createDelegation(
  api: ApiClient,
  args: CreateDelegationArgs,
): Promise<CreateDelegationResult> {
  const anchor = newAnchorToken();
  const anchored = await args.anchor(anchor);
  if (!anchored.ok) {
    return { kind: "not-anchored", reason: anchored.reason };
  }
  const created = await api.threads.create.$post({
    json: {
      title: delegationTitle(args.prompt),
      originDocPath: args.docPath,
      originAnchor: anchor,
      // `ask` never writes, so it is created `direct` and the mode stays
      // meaningless there rather than becoming a second thing to reason about.
      writeMode: args.intent === "ask" ? "direct" : args.writeMode,
    },
  });
  if (!created.ok) {
    throw new Error("Could not create the delegation thread");
  }
  const { thread } = await created.json();
  const send = await sendToThread(api, {
    threadId: thread.id,
    text: composeDelegationMessage({
      intent: args.intent,
      writeMode: args.writeMode,
      docPath: args.docPath,
      anchor,
      selectionText: args.selectionText,
      prompt: args.prompt,
    }),
    activeTurnId: null,
  });
  return { kind: "created", threadId: thread.id, anchor, send };
}
