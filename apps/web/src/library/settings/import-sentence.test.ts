import { describe, expect, it } from "vitest";

import { importSentence } from "./import-section";

const NONE = { added: 0, alreadySaved: 0, unreadable: 0 };

describe("what an import says", () => {
  it("counts what it added as it runs, and what it met once it is done", () => {
    expect(importSentence({ kind: "reading", source: "raindrop" })).toBe("Reading the file…");
    expect(
      importSentence({
        counts: { ...NONE, added: 40 },
        kind: "landing",
        source: "raindrop",
        total: 1200,
      }),
    ).toBe("Added 40 of 1,200…");
    expect(
      importSentence({ counts: { added: 1190, alreadySaved: 8, unreadable: 2 }, kind: "done" }),
    ).toBe("Added 1,190, 8 already in the library, 2 couldn't be read.");
  });

  it("says why it stopped", () => {
    expect(
      importSentence({
        counts: NONE,
        kind: "failed",
        message: "That file isn't a Raindrop export.",
      }),
    ).toBe("That file isn't a Raindrop export.");
    expect(importSentence({ counts: { ...NONE, added: 3 }, kind: "stopped" })).toBe(
      "Stopped after adding 3.",
    );
  });
});
