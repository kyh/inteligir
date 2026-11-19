import { describe, expect, it } from "vitest";

import { exportSentence } from "./export-section";

const NONE = { filesMissing: 0, items: 0, propertiesLeftOut: 0 };

describe("what an export says", () => {
  it("counts what it wrote as it runs, and what it left out once it is done", () => {
    expect(exportSentence({ kind: "listing" })).toBe("Reading the library…");
    expect(exportSentence({ kind: "writing", total: 1200, written: 40 })).toBe(
      "Wrote 40 of 1,200…",
    );
    expect(exportSentence({ counts: { ...NONE, items: 1 }, kind: "done" })).toBe("Wrote 1 item.");
    expect(
      exportSentence({
        counts: { filesMissing: 1, items: 1200, propertiesLeftOut: 2 },
        kind: "done",
      }),
    ).toBe("Wrote 1,200 items, 2 properties left out, 1 file couldn't be read.");
  });

  it("says why it stopped", () => {
    expect(exportSentence({ kind: "failed", message: "Your library can't be reached." })).toBe(
      "Your library can't be reached.",
    );
    expect(exportSentence({ kind: "stopped", written: 3 })).toBe(
      "Stopped after writing 3 items, before the zip was finished.",
    );
  });
});
