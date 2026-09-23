import type { PendingInteraction } from "@repo/api/local/threads/threads-schema";
import type {
  ApprovalPendingInteractionPayload,
  PendingInteractionApprovalSubject,
} from "@repo/domain/pending-interactions";

const subjectText = (subject: PendingInteractionApprovalSubject): string => {
  switch (subject.kind) {
    case "command": {
      return subject.cwd === null
        ? `$ ${subject.command}`
        : `$ ${subject.command} (in ${subject.cwd})`;
    }
    case "file_change": {
      return `write ${subject.writeScope ?? "unscoped"}`;
    }
    // no default
  }
};

// deny is always accepted, offered or not: every cancel path answers with it.
const answerText = (payload: ApprovalPendingInteractionPayload): string =>
  `answer: ${[...new Set([...payload.availableDecisions, "deny"])].join(", ")}`;

// what an approval would allow, so nobody answers one blind.
export const describeInteraction = (row: PendingInteraction): string[] => {
  const heading = `${row.id}  ${row.threadId}  ${row.status}`;
  const { payload } = row;
  if (payload === null) {
    return [heading, "  (no details)"];
  }
  const subject = subjectText(payload.subject);
  return [
    heading,
    `  ${payload.reason === null ? subject : `${subject} — ${payload.reason}`}`,
    `  ${answerText(payload)}`,
  ];
};
