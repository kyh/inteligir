// the contract has no "other" subject, so an unrecognised kind falls back to the command shape.
// an answer must be one of the agent's own optionIds: the exact kind first, then the same
// allow/reject family.

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

const decisionsFor = (
  options: readonly PermissionOption[],
): PendingInteractionApprovalDecision[] => {
  const decisions = new Set<PendingInteractionApprovalDecision>();
  for (const option of options) {
    switch (option.kind) {
      case "allow_once": {
        decisions.add("allow_once");
        break;
      }
      case "allow_always": {
        decisions.add("allow_for_session");
        break;
      }
      case "reject_once":
      case "reject_always": {
        decisions.add("deny");
        break;
      }
      default: {
        break;
      }
    }
  }
  if (decisions.size === 0) {
    decisions.add("allow_once");
    decisions.add("deny");
  }
  return [...decisions];
};

const subjectFor = (request: RequestPermissionRequest): PendingInteractionApprovalSubject => {
  const { toolCall } = request;
  const itemId = toolCall.toolCallId;
  const kind = toolCall.kind ?? "other";
  if (kind === "edit" || kind === "delete" || kind === "move") {
    return {
      itemId,
      kind: "file_change",
      writeScope: toolCall.locations?.[0]?.path ?? null,
    };
  }
  return {
    command: toolCall.title ?? "(unnamed tool call)",
    cwd: null,
    itemId,
    kind: "command",
  };
};

export const toApprovalPayload = (
  request: RequestPermissionRequest,
): ApprovalPendingInteractionPayload => ({
  availableDecisions: decisionsFor(request.options),
  kind: "approval",
  reason: null,
  subject: subjectFor(request),
});

const ALLOW_PREFERENCE = {
  allow_for_session: ["allow_always", "allow_once"],
  allow_once: ["allow_once", "allow_always"],
} satisfies Record<"allow_once" | "allow_for_session", readonly string[]>;

export const toPermissionOutcome = (
  request: RequestPermissionRequest,
  resolution: PendingInteractionResolution,
): RequestPermissionResponse["outcome"] => {
  const { options } = request;
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
  const [fallback] = options;
  return fallback === undefined
    ? { outcome: "cancelled" }
    : { optionId: fallback.optionId, outcome: "selected" };
};
