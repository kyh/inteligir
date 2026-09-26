// what this Mac does with a row the account's dispatch inbox hands it, and which of its own
// approvals the phone should see. the steps that claim, ack, open and close are the sync pass's;
// nothing here is stored beside the thread, because the send already writes the ledger: a phone's
// turn is held once its request (or the queued message that becomes one) names its dispatch.

import { createHash } from "node:crypto";
import {
  approvalPayloadSchema,
  DISPATCH_MESSAGE_MAX_CHARS,
} from "@repo/api/cloud/dispatch/dispatch-schema";
import type {
  ClaimedDispatch,
  DispatchResult,
  OpenApprovalRequest,
} from "@repo/api/cloud/dispatch/dispatch-schema";
import type { DbConnection } from "@repo/db/connection";
import { turnDispatchId } from "@repo/db/events";
import {
  listSettledRelayedInteractions,
  listThreadPendingInteractions,
  listUnrelayedOpenInteractions,
} from "@repo/db/pending-interactions";
import type { PendingInteractionRow } from "@repo/db/pending-interactions";
import type { ThreadService } from "../threads/service";

export type DispatchSink = Pick<ThreadService, "acceptDispatch" | "answerInteraction">;

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
      interactionId: asked.id,
      resolution: answer.decision,
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
    return asked.resolution === answer.decision
      ? { id: answer.id, outcome: "delivered" }
      : refused(answer.id, ANSWERED_HERE);
  }
  return refused(answer.id, NO_LONGER_WAITING);
};

// a throw is this build's fault, never the phone's: the caller leaves the row unacked, so its claim
// lapses and it is handed over again
export const applyDispatch = async (
  sink: DispatchSink,
  db: DbConnection,
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
    // no default
  }
};

const parseStoredPayload = (row: PendingInteractionRow): OpenApprovalRequest["payload"] | null => {
  let raw: unknown;
  try {
    raw = JSON.parse(row.payload);
  } catch {
    return null;
  }
  const parsed = approvalPayloadSchema.safeParse(raw);
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
    const payload = parseStoredPayload(row);
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

// settled here however it settled (answered on either device, timed out, its turn ended): the
// phone's card goes with it
export const approvalsToClose = (db: DbConnection): ApprovalToClose[] =>
  listSettledRelayedInteractions(db).map((row) => ({
    approvalId: approvalIdOf(row.id),
    interactionId: row.id,
  }));
