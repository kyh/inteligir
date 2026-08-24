// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ApprovalPendingInteractionPayload } from "@repo/domain/pending-interactions";
import type { PendingInteraction } from "@repo/api/local/threads/threads-schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApprovalCard, approvalOffer, decisionFromAnswers } from "../approval-card";

afterEach(cleanup);

function interactionWith(payload: ApprovalPendingInteractionPayload | null): PendingInteraction {
  return {
    id: "pint_1",
    threadId: "thr_1",
    turnId: "turn_1",
    requestKey: "req-1",
    status: "pending",
    payload,
    resolution: null,
    createdAt: 1,
    resolvedAt: null,
  };
}

const commandPayload: ApprovalPendingInteractionPayload = {
  kind: "approval",
  subject: {
    kind: "command",
    itemId: "item_1",
    command: "rm -rf node_modules",
    cwd: null,
    actions: [],
    sessionGrant: null,
  },
  reason: "The command deletes files.",
  availableDecisions: ["allow_once", "deny"],
};

describe("ApprovalCard", () => {
  it("renders the offered decisions and answers with the clicked one", () => {
    const onAnswer = vi.fn();
    render(<ApprovalCard interaction={interactionWith(commandPayload)} onAnswer={onAnswer} />);
    expect(screen.getByText("$ rm -rf node_modules")).toBeTruthy();
    expect(screen.getByText("The command deletes files.")).toBeTruthy();
    // allow_for_session was not offered, so it must not render.
    expect(screen.queryByText("Allow for session")).toBeNull();
    fireEvent.click(screen.getByText("Allow once"));
    expect(onAnswer).toHaveBeenCalledWith("pint_1", "allow_once");
  });

  it("always offers Deny", () => {
    const onAnswer = vi.fn();
    render(<ApprovalCard interaction={interactionWith(commandPayload)} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByText("Deny"));
    expect(onAnswer).toHaveBeenCalledWith("pint_1", "deny");
  });

  it("falls back to a deny-only card when the host could not read the payload", () => {
    const onAnswer = vi.fn();
    render(<ApprovalCard interaction={interactionWith(null)} onAnswer={onAnswer} />);
    expect(screen.getByText("The agent asked for approval.")).toBeTruthy();
    expect(screen.queryByText("Allow once")).toBeNull();
    fireEvent.click(screen.getByText("Deny"));
    expect(onAnswer).toHaveBeenCalledWith("pint_1", "deny");
  });

  it("disables the buttons while an answer is in flight", () => {
    const onAnswer = vi.fn();
    render(
      <ApprovalCard interaction={interactionWith(commandPayload)} onAnswer={onAnswer} disabled />,
    );
    fireEvent.click(screen.getByText("Deny"));
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("maps the payload onto the card's one radio question", () => {
    const offer = approvalOffer(interactionWith(commandPayload));
    expect(offer.summary).toBe("$ rm -rf node_modules");
    expect(offer.reason).toBe("The command deletes files.");
    // Deny is appended once, last, and never duplicated when offered.
    expect(offer.decisions).toEqual(["allow_once", "deny"]);
    expect(approvalOffer(interactionWith(null)).decisions).toEqual(["deny"]);
  });

  it("takes the picked option id as the resolution verb, and nothing else", () => {
    expect(decisionFromAnswers([{ questionId: "pint_1", optionIds: ["allow_once"] }])).toBe(
      "allow_once",
    );
    // A custom answer is not a decision this route can take.
    expect(
      decisionFromAnswers([{ questionId: "pint_1", optionIds: [], custom: "maybe" }]),
    ).toBeNull();
    expect(decisionFromAnswers([{ questionId: "pint_1", optionIds: ["nonsense"] }])).toBeNull();
    expect(decisionFromAnswers([])).toBeNull();
  });
});
