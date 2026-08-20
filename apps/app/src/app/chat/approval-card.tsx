// A pending interaction rendered as an answerable card, inline in the
// timeline. The payload contract is the approval family from @repo/domain,
// parsed server-side; a null payload still renders — with Deny as its only
// button, because deny is the one decision every request accepts
// (fail-closed, never a dead card the turn then times out on).

import type {
  ApprovalPendingInteractionPayload,
  PendingInteractionApprovalDecision,
} from "@repo/domain/pending-interactions";
import type { PendingInteraction } from "@repo/server-contract/threads";
import { Button } from "@repo/ui/components/button";

const DECISION_LABELS = {
  allow_once: "Allow once",
  allow_for_session: "Allow for session",
  deny: "Deny",
} satisfies Record<PendingInteractionApprovalDecision, string>;

export interface ApprovalCardProps {
  interaction: PendingInteraction;
  /** Resolution string for the answer route (a bare decision verb). */
  onAnswer: (interactionId: string, resolution: PendingInteractionApprovalDecision) => void;
  disabled?: boolean;
}

interface ApprovalView {
  summary: React.ReactNode;
  reason: string | null;
  decisions: PendingInteractionApprovalDecision[];
}

function approvalView(payload: ApprovalPendingInteractionPayload | null): ApprovalView {
  if (payload === null) {
    return { summary: "The agent asked for approval.", reason: null, decisions: [] };
  }
  const { subject, reason, availableDecisions: decisions } = payload;
  switch (subject.kind) {
    case "command":
      return {
        summary: <code className="font-mono text-xs">$ {subject.command}</code>,
        reason,
        decisions,
      };
    case "file_change":
      return {
        summary:
          subject.writeScope === null
            ? "Apply file changes"
            : `Apply file changes in ${subject.writeScope}`,
        reason,
        decisions,
      };
    case "permission_grant":
      return {
        summary:
          subject.toolName === null
            ? "Grant additional permissions"
            : `Grant additional permissions to ${subject.toolName}`,
        reason,
        decisions,
      };
  }
}

export function ApprovalCard({ interaction, onAnswer, disabled = false }: ApprovalCardProps) {
  const view = approvalView(interaction.payload);
  const decisions: PendingInteractionApprovalDecision[] = [
    ...view.decisions.filter((decision) => decision !== "deny"),
    "deny",
  ];
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-raised p-3 shadow-surface-1">
      <div className="text-sm">{view.summary}</div>
      {view.reason !== null && view.reason !== "" ? (
        <div className="text-xs text-muted-foreground">{view.reason}</div>
      ) : null}
      <div className="flex gap-2">
        {decisions.map((decision) => (
          <Button
            key={decision}
            size="sm"
            variant={decision === "deny" ? "ghost" : "secondary"}
            disabled={disabled}
            onClick={() => onAnswer(interaction.id, decision)}
          >
            {DECISION_LABELS[decision]}
          </Button>
        ))}
      </div>
    </div>
  );
}
