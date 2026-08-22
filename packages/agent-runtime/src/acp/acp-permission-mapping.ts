// ACP session/request_permission ↔ the pending-interaction contract, pure.
//
// The subject is derived from the tool call's declared kind the way the item
// mapping derives items: an execute call asks about a COMMAND, a file-shaped
// call (edit/delete/move) about a FILE CHANGE, and anything else falls back
// to the command shape with the call's title as the sentence — the contract
// has no "other" subject, and inventing one would fork the approval UI.
//
// Decisions map by the OPTION KINDS the agent offered: allow_once→allow_once,
// allow_always→allow_for_session, and any reject kind→deny. Answering picks
// the agent's own optionId for the user's decision, preferring the exact
// kind and falling back inside the same allow/reject family — the agent
// defined the vocabulary, so the answer must be one of its words.

import type {
  PermissionOption,
  RequestPermissionRequest,
  RequestPermissionResponse,
} from "@zed-industries/agent-client-protocol";
import type {
  ApprovalPendingInteractionPayload,
  PendingInteractionApprovalDecision,
  PendingInteractionApprovalSubject,
  PendingInteractionResolution,
} from "@repo/domain/pending-interactions";

function decisionsFor(options: readonly PermissionOption[]): PendingInteractionApprovalDecision[] {
  const decisions = new Set<PendingInteractionApprovalDecision>();
  for (const option of options) {
    switch (option.kind) {
      case "allow_once":
        decisions.add("allow_once");
        break;
      case "allow_always":
        decisions.add("allow_for_session");
        break;
      case "reject_once":
      case "reject_always":
        decisions.add("deny");
        break;
    }
  }
  if (decisions.size === 0) {
    decisions.add("allow_once");
    decisions.add("deny");
  }
  return [...decisions];
}

function subjectFor(request: RequestPermissionRequest): PendingInteractionApprovalSubject {
  const toolCall = request.toolCall;
  const itemId = toolCall.toolCallId;
  const kind = toolCall.kind ?? "other";
  if (kind === "edit" || kind === "delete" || kind === "move") {
    return {
      kind: "file_change",
      itemId,
      writeScope: toolCall.locations?.[0]?.path ?? null,
      sessionGrant: null,
    };
  }
  return {
    kind: "command",
    itemId,
    command: toolCall.title ?? "(unnamed tool call)",
    cwd: null,
    actions: [],
    sessionGrant: null,
  };
}

export function toApprovalPayload(
  request: RequestPermissionRequest,
): ApprovalPendingInteractionPayload {
  return {
    kind: "approval",
    subject: subjectFor(request),
    reason: null,
    availableDecisions: decisionsFor(request.options),
  };
}

const ALLOW_PREFERENCE = {
  allow_once: ["allow_once", "allow_always"],
  allow_for_session: ["allow_always", "allow_once"],
} satisfies Record<"allow_once" | "allow_for_session", readonly string[]>;

export function toPermissionOutcome(
  request: RequestPermissionRequest,
  resolution: PendingInteractionResolution,
): RequestPermissionResponse["outcome"] {
  const options = request.options;
  if (resolution.decision === "deny") {
    const denial =
      options.find((option) => option.kind === "reject_once") ??
      options.find((option) => option.kind === "reject_always");
    return denial === undefined
      ? { outcome: "cancelled" }
      : { optionId: denial.optionId, outcome: "selected" };
  }
  for (const wanted of ALLOW_PREFERENCE[resolution.decision]) {
    const match = options.find((option) => option.kind === wanted);
    if (match !== undefined) {
      return { optionId: match.optionId, outcome: "selected" };
    }
  }
  const fallback = options[0];
  return fallback === undefined
    ? { outcome: "cancelled" }
    : { optionId: fallback.optionId, outcome: "selected" };
}
