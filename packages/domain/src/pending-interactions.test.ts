import { describe, expect, it } from "vitest";
import {
  answerableDecisions,
  pendingInteractionApprovalDecisionValues,
  unanswerableReason,
} from "./pending-interactions";
import type { ApprovalPendingInteractionPayload } from "./pending-interactions";

const offering = (
  availableDecisions: ApprovalPendingInteractionPayload["availableDecisions"],
): ApprovalPendingInteractionPayload => ({
  availableDecisions,
  kind: "approval",
  reason: null,
  subject: { command: "ls", cwd: null, itemId: "item_1", kind: "command" },
});

describe("answerableDecisions", () => {
  it("ends with deny exactly once, offered or not", () => {
    expect(answerableDecisions(offering(["allow_once"]))).toEqual(["allow_once", "deny"]);
    expect(answerableDecisions(offering(["deny", "allow_once"]))).toEqual(["allow_once", "deny"]);
    expect(answerableDecisions(offering(["deny"]))).toEqual(["deny"]);
  });
});

describe("unanswerableReason", () => {
  it("takes every decision a request offers", () => {
    const payload = offering([...pendingInteractionApprovalDecisionValues]);
    for (const decision of pendingInteractionApprovalDecisionValues) {
      expect(unanswerableReason(payload, decision)).toBeNull();
    }
  });

  it("takes deny even when the request did not offer it", () => {
    expect(unanswerableReason(offering(["allow_once"]), "deny")).toBeNull();
  });

  it("refuses a decision the request did not offer, naming every one it would take", () => {
    expect(unanswerableReason(offering(["allow_once"]), "allow_for_session")).toBe(
      'The request offers allow_once, deny; "allow_for_session" is not among them',
    );
  });
});
