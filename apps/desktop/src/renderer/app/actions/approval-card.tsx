// a null payload still renders with Deny alone: deny is the one decision every request
// accepts, and a dead card is a turn that times out.

import type {
  ApprovalPendingInteractionPayload,
  PendingInteractionApprovalDecision,
} from "@repo/domain/pending-interactions";
import type { PendingInteraction } from "@repo/api/local/threads/threads-schema";
import {
  ApprovalCard as ApprovalCardView,
  ApprovalOption,
  ApprovalQuestion,
} from "@repo/ui/ai/approval-card";
import type { ApprovalAnswer } from "@repo/ui/ai/approval-card";

const DECISION_LABELS = {
  allow_for_session: "Allow for session",
  allow_once: "Allow once",
  deny: "Deny",
} satisfies Record<PendingInteractionApprovalDecision, string>;

const DECISIONS: readonly PendingInteractionApprovalDecision[] = [
  "allow_once",
  "allow_for_session",
  "deny",
];

const isDecision = (value: string): value is PendingInteractionApprovalDecision =>
  DECISIONS.some((decision) => decision === value);

export interface ApprovalCardProps {
  interaction: PendingInteraction;
  onAnswer: (interactionId: string, resolution: PendingInteractionApprovalDecision) => void;
  disabled?: boolean;
}

interface ApprovalView {
  summary: string;
  reason: string | null;
  decisions: PendingInteractionApprovalDecision[];
}

const approvalView = (payload: ApprovalPendingInteractionPayload | null): ApprovalView => {
  if (payload === null) {
    return { decisions: [], reason: null, summary: "The agent asked for approval." };
  }
  const { subject, reason, availableDecisions: decisions } = payload;
  switch (subject.kind) {
    case "command": {
      return { decisions, reason, summary: `$ ${subject.command}` };
    }
    case "file_change": {
      return {
        decisions,
        reason,
        summary:
          subject.writeScope === null
            ? "Apply file changes"
            : `Apply file changes in ${subject.writeScope}`,
      };
    }
    default: {
      const exhaustive: never = subject;
      return exhaustive;
    }
  }
};

export const approvalOffer = (interaction: PendingInteraction): ApprovalView => {
  const view = approvalView(interaction.payload);
  return {
    decisions: [...view.decisions.filter((decision) => decision !== "deny"), "deny"],
    reason: view.reason,
    summary: view.summary,
  };
};

export const decisionFromAnswers = (
  answers: readonly ApprovalAnswer[],
): PendingInteractionApprovalDecision | null => {
  const [answer] = answers;
  const picked = answer?.optionIds[0];
  return picked !== undefined && isDecision(picked) ? picked : null;
};

export const ApprovalCard = ({ interaction, onAnswer, disabled = false }: ApprovalCardProps) => {
  const offer = approvalOffer(interaction);
  return (
    <ApprovalCardView
      onSubmit={(answers) => {
        if (disabled) {
          return;
        }
        const decision = decisionFromAnswers(answers);
        if (decision !== null) {
          onAnswer(interaction.id, decision);
        }
      }}
      sentLabel="Answer sent"
    >
      <ApprovalQuestion
        questionId={interaction.id}
        prompt={offer.summary}
        kind="radio"
        {...(offer.reason === null || offer.reason === "" ? {} : { detail: offer.reason })}
      >
        {offer.decisions.map((decision) => (
          <ApprovalOption key={decision} optionId={decision}>
            {DECISION_LABELS[decision]}
          </ApprovalOption>
        ))}
      </ApprovalQuestion>
    </ApprovalCardView>
  );
};
