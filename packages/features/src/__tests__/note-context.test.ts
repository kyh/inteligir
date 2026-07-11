import { describe, expect, it } from "vitest";

import { buildNoteContext, stripNoteContext } from "../note-context";

describe("note context prefix", () => {
  it("attaches the open note as an agent-side prefix", () => {
    const out = buildNoteContext("add a tasks section", "daily/today.md");
    expect(out).toContain("./vault/daily/today.md");
    expect(out.endsWith("add a tasks section")).toBe(true);
  });

  it("still grounds the date when no note is open, with no note clause", () => {
    const out = buildNoteContext("hello", undefined);
    expect(out).toContain("today is");
    expect(out).not.toContain("./vault/");
    expect(out.endsWith("hello")).toBe(true);
    expect(stripNoteContext(out)).toBe("hello");
  });

  it("strips the prefix back off for display (round-trip)", () => {
    const original = "add a tasks section";
    expect(stripNoteContext(buildNoteContext(original, "n.md"))).toBe(original);
  });

  it("strips fully even when the note path contains a ]", () => {
    const out = buildNoteContext("hi", "weird]name.md");
    expect(out).toContain("./vault/weird]name.md");
    expect(stripNoteContext(out)).toBe("hi");
  });

  it("strips lazily — up to the FIRST `]\\n\\n`, never into the message body", () => {
    expect(stripNoteContext("[Context: note ./vault/a].md]\n\nhi")).toBe("hi");
    expect(stripNoteContext("[Context: a]\n\nkeep [this]\n\ntail")).toBe("keep [this]\n\ntail");
  });

  it("strips a persisted-history prefix verbatim", () => {
    expect(stripNoteContext("[Context: today is Friday. The note is ./vault/a.md]\n\nhi")).toBe(
      "hi",
    );
  });

  it("leaves a plain message untouched", () => {
    expect(stripNoteContext("just a normal message")).toBe("just a normal message");
  });

  it("does not strip a bracketed message that isn't a context prefix", () => {
    const text = "[TODO] buy milk\n\nand bread";
    expect(stripNoteContext(text)).toBe(text);
  });
});
