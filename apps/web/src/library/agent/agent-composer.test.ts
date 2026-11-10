import { describe, expect, it } from "vitest";

import { COMPOSER_START, composerAfter } from "./agent-composer";
import type { ComposerEvent, ComposerState } from "./agent-composer";

const THREAD = "0199a4c2-0000-7000-8000-00000000000a";

const after = (events: readonly ComposerEvent[], from: ComposerState = COMPOSER_START) => {
  let state = from;
  for (const event of events) {
    state = composerAfter(state, event);
  }
  return state;
};

describe("the agent's composer", () => {
  it("sends to the conversation chosen, or to a new one", () => {
    expect(after([{ kind: "chose", threadId: THREAD }])).toStrictEqual({
      kind: "asking",
      passage: null,
      threadId: THREAD,
    });
    expect(
      after([
        { kind: "chose", threadId: THREAD },
        { kind: "chose", threadId: null },
      ]),
    ).toStrictEqual(COMPOSER_START);
    expect(composerAfter(COMPOSER_START, { kind: "chose", threadId: null })).toBe(COMPOSER_START);
  });

  it("holds a Tidy on a conversation of its own until it is sent, dropped, or one is chosen", () => {
    const tidying = after([{ kind: "chose", threadId: THREAD }, { kind: "tidy" }]);
    expect(tidying).toStrictEqual({ kind: "tidying" });
    expect(composerAfter(tidying, { kind: "chose", threadId: null })).toBe(tidying);
    expect(composerAfter(tidying, { kind: "tidyEnded" })).toStrictEqual(COMPOSER_START);
    expect(composerAfter(tidying, { kind: "chose", threadId: THREAD })).toStrictEqual({
      kind: "asking",
      passage: null,
      threadId: THREAD,
    });
  });

  it("ends no Tidy it does not hold", () => {
    const asking = after([{ kind: "chose", threadId: THREAD }]);
    expect(composerAfter(asking, { kind: "tidyEnded" })).toBe(asking);
    expect(composerAfter(COMPOSER_START, { kind: "tidyEnded" })).toBe(COMPOSER_START);
  });

  it("holds a passage the editor asked about until the field quotes it, letting a Tidy go", () => {
    const asked = after([
      { kind: "chose", threadId: THREAD },
      { kind: "asked", passage: "the passage" },
    ]);
    expect(asked).toStrictEqual({ kind: "asking", passage: "the passage", threadId: THREAD });
    expect(composerAfter(asked, { kind: "quoted" })).toStrictEqual({
      kind: "asking",
      passage: null,
      threadId: THREAD,
    });
    expect(after([{ kind: "tidy" }, { kind: "asked", passage: "the passage" }])).toStrictEqual({
      kind: "asking",
      passage: "the passage",
      threadId: null,
    });
    expect(composerAfter(COMPOSER_START, { kind: "quoted" })).toBe(COMPOSER_START);
  });
});
