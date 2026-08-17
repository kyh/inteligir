// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PendingInteraction } from "@repo/server-contract/threads";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApprovalCard } from "../approval-card";

afterEach(cleanup);

function interactionWith(payload: unknown): PendingInteraction {
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

const commandPayload = {
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

  it("falls back to a deny-only card for a payload it cannot parse", () => {
    const onAnswer = vi.fn();
    render(<ApprovalCard interaction={interactionWith({ mystery: true })} onAnswer={onAnswer} />);
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
});
