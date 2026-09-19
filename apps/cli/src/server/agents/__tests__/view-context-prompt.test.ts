import type { ViewContext } from "@repo/domain/view-context";
import { describe, expect, it } from "vitest";
import { composeViewContextBlock, turnPromptInput } from "../view-context-prompt";

const REVISION = "b".repeat(64);

const docContext = (): ViewContext => ({
  resource: "Notes/Plans.md",
  revision: REVISION,
  surface: "doc",
});

describe("composeViewContextBlock", () => {
  it("names the file and the revision", () => {
    expect(composeViewContextBlock(docContext())).toBe(
      `The user sent this while looking at Notes/Plans.md in the editor — "this", "here" and "the note" refer to that file. It hashed to sha-256 ${REVISION} when they sent it; if it no longer does, it changed afterwards.`,
    );
  });
});

describe("turnPromptInput", () => {
  it("carries the user's text alone when there is no context", () => {
    expect(turnPromptInput("make this shorter")).toEqual([
      { text: "make this shorter", type: "text" },
    ]);
  });

  it("leads with the view-context block and leaves the user's text its own element", () => {
    const input = turnPromptInput("make this shorter", docContext());
    expect(input).toHaveLength(2);
    expect(input[0]?.text).toBe(composeViewContextBlock(docContext()));
    expect(input[1]).toEqual({ text: "make this shorter", type: "text" });
  });
});
