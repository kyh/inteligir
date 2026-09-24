// a null payload still renders with Deny alone: deny is the one decision every request
// accepts, and a dead card is a turn that times out.

import {
  answerableDecisions,
  pendingInteractionApprovalDecisionSchema,
} from "@repo/domain/pending-interactions";
import type { PendingInteractionApprovalDecision } from "@repo/domain/pending-interactions";
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

const isDecision = (value: string): value is PendingInteractionApprovalDecision =>
  pendingInteractionApprovalDecisionSchema.safeParse(value).success;

export interface ApprovalCardProps {
  interaction: PendingInteraction;
  // a rejection hands the card back its options, so a refused answer can be sent again
  onAnswer: (
    interactionId: string,
    resolution: PendingInteractionApprovalDecision,
  ) => Promise<void>;
}

interface ApprovalView {
  summary: string;
  reason: string | null;
  decisions: PendingInteractionApprovalDecision[];
}

export const approvalOffer = ({ payload }: PendingInteraction): ApprovalView => {
  if (payload === null) {
    return { decisions: ["deny"], reason: null, summary: "The agent asked for approval." };
  }
  const { subject, reason } = payload;
  const decisions = answerableDecisions(payload);
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

export const decisionFromAnswers = (
  answers: readonly ApprovalAnswer[],
): PendingInteractionApprovalDecision | null => {
  const [answer] = answers;
  const picked = answer?.optionIds[0];
  return picked !== undefined && isDecision(picked) ? picked : null;
};

export const ApprovalCard = ({ interaction, onAnswer }: ApprovalCardProps) => {
  const offer = approvalOffer(interaction);
  return (
    <ApprovalCardView
      onSubmit={async (answers) => {
        const decision = decisionFromAnswers(answers);
        if (decision !== null) {
          await onAnswer(interaction.id, decision);
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
