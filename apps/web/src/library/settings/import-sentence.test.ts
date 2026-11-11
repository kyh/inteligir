import { describe, expect, it } from "vitest";

import { importSentence } from "./import-section";

const JOB = {
  added: 0,
  alreadySaved: 0,
  changeSetId: null,
  finishedAt: null,
  id: "0199a4c2-0000-7000-8000-0000000000aa",
  message: null,
  skipped: 0,
  source: "raindrop" as const,
  startedAt: 1_790_000_000_000,
  state: "running" as const,
  total: 0,
  unreadable: 0,
};

describe("what an import says", () => {
  it("counts what it added as it runs, and what it met once it is done", () => {
    expect(importSentence(JOB)).toBe("Reading the file…");
    expect(importSentence({ ...JOB, added: 40, total: 1200 })).toBe("Added 40 of 1,200…");
    expect(
      importSentence({ ...JOB, added: 1190, alreadySaved: 8, state: "done", unreadable: 2 }),
    ).toBe("Added 1,190, 8 already in the library, 2 couldn't be read.");
  });

  it("says why it stopped", () => {
    expect(
      importSentence({ ...JOB, message: "That file isn't a Raindrop export.", state: "failed" }),
    ).toBe("That file isn't a Raindrop export.");
    expect(importSentence({ ...JOB, added: 3, state: "cancelled" })).toBe(
      "Stopped after adding 3.",
    );
  });
});
