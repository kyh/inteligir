// The open note's suggestion header: the count, accept-all/reject-all, and —
// when a suggestion cannot be marked in the document — the reason and the way
// out.
//
// A STALE SUGGESTION OFFERS A RE-RUN, NEVER AN APPLY. Its hunks were computed
// against bytes the file no longer holds, so applying them would be a guess
// about text the agent never saw; the accept route refuses it anyway, and
// offering the button would only turn a refusal into a surprise.
//
// The re-run affordance OPENS THE THREAD rather than sending anything, and it
// says so — "Ask again", not "Re-run". A button that silently started a turn
// would be composing a message on the user's behalf, on a note that has since
// changed, which is the same class of surprise from the other end.

import type { Proposal } from "@repo/server-contract/proposals";
import { Button } from "@repo/ui/components/button";
import type { ProposalActions } from "./proposal-hooks";

export interface ProposalBarProps {
  /** Every suggestion against the open note, pending and stale alike. */
  proposals: readonly Proposal[];
  actions: ProposalActions;
  /** True while the buffer differs from the base, so the in-document marks
   *  are withheld and this bar is the only surface. */
  unplaceable: boolean;
  /** Open the thread that produced a stale suggestion, so the user can ask
   *  for it again against the note as it is now. */
  onOpenThread: (threadId: string) => void;
}

function hunkCount(proposals: readonly Proposal[]): number {
  return proposals.reduce(
    // A deletion carries no hunks and is still one thing to decide.
    (total, proposal) => total + Math.max(proposal.hunks.length, 1),
    0,
  );
}

export function ProposalBar({ proposals, actions, unplaceable, onOpenThread }: ProposalBarProps) {
  if (proposals.length === 0) {
    return null;
  }
  const pending = proposals.filter((proposal) => proposal.status === "pending");
  const stale = proposals.filter((proposal) => proposal.status === "stale");

  return (
    <div className="mb-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
      {pending.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">
            {hunkCount(pending)} suggested edit{hunkCount(pending) === 1 ? "" : "s"}
          </span>
          <span className="text-muted-foreground">
            {unplaceable
              ? "— save this note to review them line by line"
              : "— review them in the document, or decide all at once"}
          </span>
          <span className="ml-auto flex gap-1">
            <Button
              variant="outline"
              size="xs"
              disabled={actions.pending}
              onClick={() => {
                for (const proposal of pending) {
                  void actions.accept({
                    proposalId: proposal.id,
                    expectedRevision: proposal.revision,
                  });
                }
              }}
            >
              Accept all
            </Button>
            <Button
              variant="ghost"
              size="xs"
              disabled={actions.pending}
              onClick={() => {
                for (const proposal of pending) {
                  void actions.reject({
                    proposalId: proposal.id,
                    expectedRevision: proposal.revision,
                  });
                }
              }}
            >
              Reject all
            </Button>
          </span>
        </div>
      ) : null}
      {stale.map((proposal) => (
        <div key={proposal.id} className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-muted-foreground">
            A suggested edit is out of date — this note changed after it was written.
          </span>
          <span className="ml-auto flex gap-1">
            <Button variant="outline" size="xs" onClick={() => onOpenThread(proposal.threadId)}>
              Ask again
            </Button>
            <Button
              variant="ghost"
              size="xs"
              disabled={actions.pending}
              onClick={() =>
                void actions.reject({
                  proposalId: proposal.id,
                  expectedRevision: proposal.revision,
                })
              }
            >
              Discard
            </Button>
          </span>
        </div>
      ))}
    </div>
  );
}
