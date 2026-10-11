// what this Mac does with a row the account's dispatch inbox hands it, and which of its own
// approvals the phone should see. the steps that claim, ack, open and close are the sync pass's;
// nothing here is stored beside the thread, because the send already writes the ledger: a phone's
// turn is held once its request (or the queued message that becomes one) names its dispatch, and
// an answer once its interaction settles. a capture has no ledger but its bullet in Inbox.md,
// which carries no id, so a capture the inbox hands over again after its ack was lost for good is
// written again: a repeated bullet, chosen over one lost.

import { createHash } from "node:crypto";
import {
  approvalPayloadSchema,
  DISPATCH_MESSAGE_MAX_CHARS,
} from "@repo/contract/cloud/dispatch/dispatch-schema";
import type {
  ClaimedDispatch,
  DispatchResult,
  OpenApprovalRequest,
} from "@repo/contract/cloud/dispatch/dispatch-schema";
import type { DbConnection } from "@repo/db/connection";
import { turnDispatchId } from "@repo/db/events";
import {
  listAllOpenPendingInteractions,
  listSettledRelayedInteractions,
  listThreadPendingInteractions,
  listUnrelayedOpenInteractions,
} from "@repo/db/pending-interactions";
import type { PendingInteractionRow } from "@repo/db/pending-interactions";
import { CAPTURE_INBOX_PATH } from "@repo/notes/sync/reconcile-file";
import { messageOf } from "../error-message";
import type { ThreadService } from "../threads/service";
import { VaultServiceError } from "../vault/vault-service";
import type { VaultService } from "../vault/vault-service";

export type DispatchSink = Pick<ThreadService, "acceptDispatch" | "answerInteraction">;

export type InboxVault = Pick<VaultService, "read" | "writeIfUnchanged" | "writeGuarded">;

export interface DispatchTarget {
  sink: DispatchSink;
  db: DbConnection;
  vault: InboxVault;
}

// the phone's words for an answer that found nothing to answer
const NO_LONGER_WAITING = "That request is no longer waiting.";
const ANSWERED_HERE = "That request was already answered on your Mac.";

// derived, never minted and stored: a Mac that restarts before the open's answer lands asks for the
// same row again, and the inbox's ids are 128 bits of hex
export const approvalIdOf = (interactionId: string): string =>
  createHash("sha256").update(interactionId).digest("hex").slice(0, 32);

const refused = (id: string, message: string): DispatchResult => ({
  id,
  message: message.slice(0, DISPATCH_MESSAGE_MAX_CHARS),
  outcome: "refused",
});

type ClaimedAnswer = Extract<ClaimedDispatch, { kind: "answer" }>;

// found among every row the thread ever raised, so a second delivery of an answer this Mac already
// applied reads as delivered again rather than as one that came too late
const answerApproval = (
  sink: DispatchSink,
  db: DbConnection,
  answer: ClaimedAnswer,
): DispatchResult => {
  const asked = listThreadPendingInteractions(db, answer.threadId).find(
    (row) => approvalIdOf(row.id) === answer.approvalId,
  );
  if (asked === undefined) {
    return refused(answer.id, NO_LONGER_WAITING);
  }
  if (asked.status === "pending") {
    const outcome = sink.answerInteraction({
      decision: answer.decision,
      interactionId: asked.id,
      threadId: answer.threadId,
    });
    switch (outcome.kind) {
      case "resolved": {
        return { id: answer.id, outcome: "delivered" };
      }
      case "invalid-resolution": {
        return refused(answer.id, outcome.message);
      }
      case "already-resolved":
      case "not-found": {
        return refused(answer.id, ANSWERED_HERE);
      }
      // no default
    }
  }
  if (asked.status === "resolved") {
    return asked.decision === answer.decision
      ? { id: answer.id, outcome: "delivered" }
      : refused(answer.id, ANSWERED_HERE);
  }
  return refused(answer.id, NO_LONGER_WAITING);
};

// indented continuation lines keep a multi-line capture inside its list item.
const inboxBullet = (text: string): string => `- ${text.replaceAll("\n", "\n  ")}\n`;

const readInbox = async (vault: InboxVault): Promise<string | null> => {
  try {
    const { content } = await vault.read(CAPTURE_INBOX_PATH);
    return content;
  } catch (error) {
    if (error instanceof VaultServiceError && error.code === "not_found") {
      return null;
    }
    throw new Error(`could not read ${CAPTURE_INBOX_PATH}: ${messageOf(error)}`, { cause: error });
  }
};

// the vault changing under the write is a throw like any other: the row is left unacked and comes
// back once its claim lapses
const appendToInbox = async (vault: InboxVault, text: string): Promise<void> => {
  const addition = inboxBullet(text);
  const current = await readInbox(vault);
  if (current === null) {
    const created = await vault.writeGuarded(CAPTURE_INBOX_PATH, `# Inbox\n\n${addition}`, {
      kind: "absent",
    });
    if (!created.applied) {
      throw new Error(`${CAPTURE_INBOX_PATH} appeared under the capture write; retrying`);
    }
    return;
  }
  const separator = current === "" || current.endsWith("\n") ? "" : "\n";
  const written = await vault.writeIfUnchanged(
    CAPTURE_INBOX_PATH,
    current,
    `${current}${separator}${addition}`,
  );
  if (!written.applied) {
    throw new Error(`${CAPTURE_INBOX_PATH} changed under the capture write; retrying`);
  }
};

// a throw is this build's fault or the vault's, never the phone's: the caller leaves the row
// unacked, so its claim lapses and it is handed over again
export const applyDispatch = async (
  { db, sink, vault }: DispatchTarget,
  dispatch: ClaimedDispatch,
): Promise<DispatchResult> => {
  switch (dispatch.kind) {
    case "turn": {
      const outcome = await sink.acceptDispatch(dispatch);
      return outcome.kind === "refused"
        ? refused(dispatch.id, outcome.message)
        : { id: dispatch.id, outcome: "delivered" };
    }
    case "answer": {
      return answerApproval(sink, db, dispatch);
    }
    case "capture": {
      await appendToInbox(vault, dispatch.text);
      return { id: dispatch.id, outcome: "delivered" };
    }
    // no default
  }
};

const relayablePayload = (row: PendingInteractionRow): OpenApprovalRequest["payload"] | null => {
  const parsed = approvalPayloadSchema.safeParse(row.payload);
  return parsed.success ? parsed.data : null;
};

export interface ApprovalToOpen {
  interactionId: string;
  request: OpenApprovalRequest;
}

// a phone-started turn's approvals only: one asked over this Mac's own keyboard is answered here.
// a payload the inbox would refuse (past its byte bound) is left to this Mac's card alone.
export const approvalsToOpen = (db: DbConnection): ApprovalToOpen[] =>
  listUnrelayedOpenInteractions(db).flatMap((row): ApprovalToOpen[] => {
    const { turnId } = row;
    if (turnId === null || turnDispatchId(db, { threadId: row.threadId, turnId }) === null) {
      return [];
    }
    const payload = relayablePayload(row);
    return payload === null
      ? []
      : [
          {
            interactionId: row.id,
            request: { id: approvalIdOf(row.id), payload, threadId: row.threadId, turnId },
          },
        ];
  });

export interface ApprovalToClose {
  interactionId: string;
  approvalId: string;
}

const closing = (row: PendingInteractionRow): ApprovalToClose => ({
  approvalId: approvalIdOf(row.id),
  interactionId: row.id,
});

// settled here however it settled (answered on either device, timed out, its turn ended): the
// phone's card goes with it
export const approvalsToClose = (db: DbConnection): ApprovalToClose[] =>
  listSettledRelayedInteractions(db).map(closing);

// every approval the phone holds, settled here or still waiting: a Mac that no longer takes the
// phone's requests would never claim an answer to one, so the phone would wait on it for good.
// one still waiting stays answerable here.
export const approvalsToWithdraw = (db: DbConnection): ApprovalToClose[] =>
  [
    ...listAllOpenPendingInteractions(db).filter((row) => row.relay === "opened"),
    ...listSettledRelayedInteractions(db),
  ].map(closing);
