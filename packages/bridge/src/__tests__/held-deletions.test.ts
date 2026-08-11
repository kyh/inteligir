// The deletion gate's refusal is read by a user (a toast) and by a model (the
// agent tool's failure), and both act on what it says. No confirmation verb
// crosses the Bridge, so the one thing the sentence must never do is name one:
// a user hunts for a button that does not exist, and a model reports back that
// the human should press it. What releases the hold is the window draining, and
// that is what has to be in the words.

import { describe, expect, it } from "vitest";

import { heldDeletionMessage, type HeldDeletions } from "../vault";

const HELD: HeldDeletions = {
  deletions: 26,
  liveCount: 300,
  limit: 25,
  windowMs: 10 * 60 * 1000,
  sample: ["notes/one.md"],
};

describe("heldDeletionMessage", () => {
  it("names only recourse a caller has", () => {
    const message = heldDeletionMessage(HELD);
    expect(message).not.toMatch(/confirm/i);
    expect(message).toContain("rolling window that drains on its own");
  });

  it("says the delete did not happen, and names what it would have removed", () => {
    const message = heldDeletionMessage(HELD);
    expect(message).toContain("Nothing was deleted");
    expect(message).toContain('"notes/one.md"');
  });

  it("states the window in minutes, so waiting it out is a length of time", () => {
    expect(heldDeletionMessage(HELD)).toContain("inside 10 minutes");
    expect(heldDeletionMessage({ ...HELD, windowMs: 30 * 60 * 1000 })).toContain(
      "inside 30 minutes",
    );
  });

  it("rounds a fractional limit rather than printing one", () => {
    expect(heldDeletionMessage({ ...HELD, liveCount: 601, limit: 30.05 })).toContain(
      "limit of 30 for a vault of 601 files",
    );
  });
});
