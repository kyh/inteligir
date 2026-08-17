// A suggested edit as the thread shows it: which file, how much, and the two
// whole-proposal verbs — the same review, reachable from the conversation
// that produced it rather than only from the document it touches.
//
// The per-hunk review lives in the editor, beside the lines, so this card
// links to the doc instead of duplicating it: two places to accept a single hunk is two
// places to get the revision guard wrong.

import type { Proposal } from "@repo/server-contract/proposals";
import { Button } from "@repo/ui/components/button";
import type { ProposalActions } from "./proposal-hooks";

export interface ProposalSummaryProps {
  proposal: Proposal;
  actions: ProposalActions;
  onOpenDoc: (path: string) => void;
}

function describe(proposal: Proposal): string {
  if (proposal.proposedContent === null) {
    return "delete this file";
  }
  if (proposal.baseHash === null) {
    return "create this file";
  }
  const count = proposal.hunks.length;
  return `${count} change${count === 1 ? "" : "s"}`;
}

export function ProposalSummary({ proposal, actions, onOpenDoc }: ProposalSummaryProps) {
  const stale = proposal.status === "stale";
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium">Suggested edit</span>
        <button
          type="button"
          className="truncate text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => onOpenDoc(proposal.docPath)}
        >
          {proposal.docPath}
        </button>
        <span className="text-muted-foreground">— {describe(proposal)}</span>
      </div>
      {stale ? (
        <p className="mt-1 text-xs text-muted-foreground">
          The file changed after this was written, so it cannot be applied. Ask again in this thread
          to redo it against what is there now.
        </p>
      ) : null}
      <div className="mt-2 flex gap-1">
        {stale ? null : (
          <Button
            size="xs"
            variant="outline"
            disabled={actions.pending}
            onClick={() =>
              void actions.accept({
                proposalId: proposal.id,
                expectedRevision: proposal.revision,
              })
            }
          >
            Accept
          </Button>
        )}
        <Button
          size="xs"
          variant="ghost"
          disabled={actions.pending}
          onClick={() =>
            void actions.reject({
              proposalId: proposal.id,
              expectedRevision: proposal.revision,
            })
          }
        >
          {stale ? "Discard" : "Reject"}
        </Button>
        <Button size="xs" variant="ghost" onClick={() => onOpenDoc(proposal.docPath)}>
          Review in the note
        </Button>
      </div>
    </div>
  );
}
