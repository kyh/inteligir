// @vitest-environment jsdom

// The two surfaces that make a suggestion discoverable without opening the
// gutter: the doc's own bar and the thread dock's card. The property both
// have to hold is the same one — a STALE suggestion never offers an apply,
// because its hunks were computed against bytes the file no longer has and
// the server would refuse them anyway.

import type { Proposal } from "@repo/server-contract/proposals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProposalBar } from "../proposal-bar";
import { ProposalSummary } from "../proposal-summary";
import type { ProposalActions } from "../proposal-hooks";

afterEach(cleanup);

const proposal = (over: Partial<Proposal> = {}): Proposal => ({
  id: "prp_1",
  threadId: "thr_1",
  turnId: "turn_1",
  docPath: "Notes.md",
  status: "pending",
  revision: 2,
  baseHash: "a".repeat(64),
  baseContent: "alpha\n",
  proposedContent: "ALPHA\n",
  hunks: [{ index: 0, baseStart: 0, baseEnd: 1, baseLines: ["alpha"], proposedLines: ["ALPHA"] }],
  acceptedHunks: 0,
  createdAt: 0,
  updatedAt: 0,
  resolvedAt: null,
  ...over,
});

function actions(): ProposalActions & { accept: ReturnType<typeof vi.fn> } {
  const accept = vi.fn(() => Promise.resolve());
  const reject = vi.fn(() => Promise.resolve());
  return { accept, reject, pending: false };
}

describe("the doc's suggestion bar", () => {
  it("renders nothing when there is nothing to review", () => {
    const { container } = render(
      <ProposalBar proposals={[]} actions={actions()} unplaceable={false} onOpenThread={vi.fn()} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("counts the hunks and applies every pending suggestion at the revision it read", () => {
    const verbs = actions();
    render(
      <ProposalBar
        proposals={[proposal()]}
        actions={verbs}
        unplaceable={false}
        onOpenThread={vi.fn()}
      />,
    );
    expect(screen.getByText("1 suggested edit")).toBeDefined();
    fireEvent.click(screen.getByText("Accept all"));
    expect(verbs.accept).toHaveBeenCalledWith({ proposalId: "prp_1", expectedRevision: 2 });
  });

  it("says why the gutter is dark when the buffer has moved", () => {
    render(
      <ProposalBar
        proposals={[proposal()]}
        actions={actions()}
        unplaceable
        onOpenThread={vi.fn()}
      />,
    );
    expect(screen.getByText(/save this note to review them line by line/u)).toBeDefined();
  });

  it("a STALE suggestion offers a re-run and a discard, never an accept", () => {
    const verbs = actions();
    const onOpenThread = vi.fn();
    render(
      <ProposalBar
        proposals={[proposal({ status: "stale" })]}
        actions={verbs}
        unplaceable={false}
        onOpenThread={onOpenThread}
      />,
    );
    expect(screen.queryByText("Accept all")).toBeNull();
    fireEvent.click(screen.getByText("Re-run"));
    expect(onOpenThread).toHaveBeenCalledWith("thr_1");
    fireEvent.click(screen.getByText("Discard"));
    expect(verbs.reject).toHaveBeenCalledWith({ proposalId: "prp_1", expectedRevision: 2 });
  });
});

describe("the thread dock's suggestion card", () => {
  it("names the file and the size of the change", () => {
    render(<ProposalSummary proposal={proposal()} actions={actions()} onOpenDoc={vi.fn()} />);
    expect(screen.getByText("Notes.md")).toBeDefined();
    expect(screen.getByText("— 1 change")).toBeDefined();
  });

  it("describes a creation and a deletion as what they are, not as N changes", () => {
    const { rerender } = render(
      <ProposalSummary
        proposal={proposal({ baseHash: null, baseContent: "" })}
        actions={actions()}
        onOpenDoc={vi.fn()}
      />,
    );
    expect(screen.getByText("— create this file")).toBeDefined();
    rerender(
      <ProposalSummary
        proposal={proposal({ proposedContent: null, hunks: [] })}
        actions={actions()}
        onOpenDoc={vi.fn()}
      />,
    );
    expect(screen.getByText("— delete this file")).toBeDefined();
  });

  it("opens the doc from the path and from the review link", () => {
    const onOpenDoc = vi.fn();
    render(<ProposalSummary proposal={proposal()} actions={actions()} onOpenDoc={onOpenDoc} />);
    fireEvent.click(screen.getByText("Notes.md"));
    fireEvent.click(screen.getByText("Review in the note"));
    expect(onOpenDoc).toHaveBeenCalledTimes(2);
    expect(onOpenDoc).toHaveBeenCalledWith("Notes.md");
  });

  it("a STALE card drops the accept and says why", () => {
    render(
      <ProposalSummary
        proposal={proposal({ status: "stale" })}
        actions={actions()}
        onOpenDoc={vi.fn()}
      />,
    );
    expect(screen.queryByText("Accept")).toBeNull();
    expect(screen.getByText("Discard")).toBeDefined();
    expect(screen.getByText(/cannot be applied/u)).toBeDefined();
  });

  it("both verbs carry the revision the card was rendered from", () => {
    const verbs = actions();
    render(
      <ProposalSummary proposal={proposal({ revision: 9 })} actions={verbs} onOpenDoc={vi.fn()} />,
    );
    fireEvent.click(screen.getByText("Accept"));
    fireEvent.click(screen.getByText("Reject"));
    expect(verbs.accept).toHaveBeenCalledWith({ proposalId: "prp_1", expectedRevision: 9 });
    expect(verbs.reject).toHaveBeenCalledWith({ proposalId: "prp_1", expectedRevision: 9 });
  });
});
