import { describe, expect, it } from "vitest";

import { COMPOSER_START, composerAfter } from "./agent-composer";
import type { ComposerEvent, ComposerState } from "./agent-composer";

const THREAD = "0199a4c2-0000-7000-8000-00000000000a";
const QUOTE = "> the passage\n\n";

const after = (events: readonly ComposerEvent[], from: ComposerState = COMPOSER_START) => {
  let state = from;

  for (const event of events) {
    state = composerAfter(state, event);
  }

  return state;
};

describe("the agent's composer", () => {
  it("sends to the conversation chosen, or to a new one, keeping what is typed", () => {
    const typed = after([
      { kind: "typed", text: "Half a thought" },
      { kind: "chose", threadId: THREAD },
    ]);

    expect(typed).toStrictEqual({
      quoted: 0,
      target: { kind: "asking", threadId: THREAD },
      text: "Half a thought",
    });
    expect(
      after([
        { kind: "chose", threadId: THREAD },
        { kind: "chose", threadId: null },
      ]),
    ).toStrictEqual(COMPOSER_START);
    expect(composerAfter(COMPOSER_START, { kind: "chose", threadId: null })).toBe(COMPOSER_START);
    expect(composerAfter(typed, { kind: "chose", threadId: THREAD })).toBe(typed);
  });

  it("holds a Tidy on a conversation of its own until it is sent, dropped, or one is chosen", () => {
    const tidying = after([{ kind: "chose", threadId: THREAD }, { kind: "tidy" }]);
    expect(tidying.target).toStrictEqual({ kind: "tidying" });
    expect(composerAfter(tidying, { kind: "tidy" })).toBe(tidying);
    expect(composerAfter(tidying, { kind: "chose", threadId: null })).toBe(tidying);
    expect(composerAfter(tidying, { kind: "tidyEnded" })).toStrictEqual(COMPOSER_START);
    expect(composerAfter(tidying, { kind: "chose", threadId: THREAD }).target).toStrictEqual({
      kind: "asking",
      threadId: THREAD,
    });
  });

  it("ends no Tidy it does not hold", () => {
    const asking = after([{ kind: "chose", threadId: THREAD }]);
    expect(composerAfter(asking, { kind: "tidyEnded" })).toBe(asking);
    expect(composerAfter(COMPOSER_START, { kind: "tidyEnded" })).toBe(COMPOSER_START);
  });

  it("quotes a passage the editor asked about under what is typed, once, letting a Tidy go", () => {
    const asked = after([
      { kind: "chose", threadId: THREAD },
      { kind: "typed", text: "Compare these." },
      { kind: "asked", passage: "the passage" },
    ]);

    expect(asked).toStrictEqual({
      quoted: 1,
      target: { kind: "asking", threadId: THREAD },
      text: `Compare these.\n\n${QUOTE}`,
    });
    expect(composerAfter(asked, { kind: "asked", passage: "the passage" })).toStrictEqual({
      ...asked,
      quoted: 2,
    });
    expect(after([{ kind: "tidy" }, { kind: "asked", passage: "the passage" }])).toStrictEqual({
      quoted: 1,
      target: { kind: "asking", threadId: null },
      text: QUOTE,
    });
  });

  it("counts a quoted passage as waiting only until the person types or sends", () => {
    const asked = after([{ kind: "asked", passage: "the passage" }]);
    expect(composerAfter(asked, { kind: "typed", text: `${QUOTE}Why?` }).quoted).toBe(0);
    expect(composerAfter(asked, { kind: "sent", threadId: THREAD }).quoted).toBe(0);
  });

  it("is empty on the conversation a message went to once it is sent, which lets a Tidy go", () => {
    const sent = { quoted: 0, target: { kind: "asking", threadId: THREAD }, text: "" };
    expect(
      after([
        { kind: "typed", text: "File these." },
        { kind: "sent", threadId: THREAD },
      ]),
    ).toStrictEqual(sent);
    expect(
      after([
        { kind: "tidy" },
        { kind: "typed", text: "Skip recipes" },
        { kind: "sent", threadId: THREAD },
      ]),
    ).toStrictEqual(sent);
  });
});
