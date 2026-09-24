import { describe, expect, it } from "vitest";
import {
  answerableDecisions,
  parseApprovalResolution,
  pendingInteractionApprovalDecisionSchema,
} from "../pending-interactions";
import type { ApprovalPendingInteractionPayload } from "../pending-interactions";

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

describe("parseApprovalResolution", () => {
  it("reads every decision the grammar names as a bare word", () => {
    const payload = offering(pendingInteractionApprovalDecisionSchema.options);
    for (const decision of pendingInteractionApprovalDecisionSchema.options) {
      expect(parseApprovalResolution(` ${decision}\n`, payload)).toEqual({
        ok: true,
        resolution: { decision },
      });
    }
  });

  it("reads the json form the same way", () => {
    expect(parseApprovalResolution('{"decision":"allow_once"}', offering(["allow_once"]))).toEqual({
      ok: true,
      resolution: { decision: "allow_once" },
    });
  });

  it("accepts deny even when the request did not offer it", () => {
    expect(parseApprovalResolution("deny", offering(["allow_once"]))).toEqual({
      ok: true,
      resolution: { decision: "deny" },
    });
  });

  it("refuses a decision the request did not offer, naming every one it would take", () => {
    expect(parseApprovalResolution("allow_for_session", offering(["allow_once"]))).toEqual({
      ok: false,
      reason: 'The request offers allow_once, deny; "allow_for_session" is not among them',
    });
  });

  it("refuses a word the grammar does not name", () => {
    expect(parseApprovalResolution("allow_always", offering(["allow_once"]))).toEqual({
      ok: false,
      reason: "The resolution names no known decision",
    });
  });
});
