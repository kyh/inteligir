import { describe, expect, it } from "vitest";

import {
  applyFauxAgentScript,
  ensureFauxProvider,
  resetFauxResponses,
} from "../provider/faux-provider";

describe("applyFauxAgentScript", () => {
  it("queues exactly one response per step", () => {
    applyFauxAgentScript({
      steps: [
        {
          text: "Editing…",
          toolCalls: [
            {
              name: "edit",
              arguments: { path: "./vault/a.md", edits: [{ oldText: "x", newText: "y" }] },
            },
          ],
        },
        { text: "Done." },
      ],
    });
    expect(ensureFauxProvider().getPendingResponseCount()).toBe(2);
    resetFauxResponses();
  });

  it("restores the self-refilling echo on empty steps", () => {
    applyFauxAgentScript({ steps: [{ text: "one" }] });
    applyFauxAgentScript({ steps: [] });
    // The echo is a single queued factory that re-appends itself per turn.
    expect(ensureFauxProvider().getPendingResponseCount()).toBe(1);
  });
});
