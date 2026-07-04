import { describe, expect, it } from "vitest";

import { stripNoteContext, withNoteContext } from "@renderer/stores/agent-store";

describe("note context prefix", () => {
  it("attaches the open note as an agent-side prefix", () => {
    const out = withNoteContext("add a tasks section", "daily/today.md");
    expect(out).toContain("./vault/daily/today.md");
    expect(out.endsWith("add a tasks section")).toBe(true);
  });

  it("still grounds the date when no note is open, with no note clause", () => {
    const out = withNoteContext("hello", undefined);
    expect(out).toContain("today is");
    expect(out).not.toContain("./vault/");
    expect(out.endsWith("hello")).toBe(true);
    expect(stripNoteContext(out)).toBe("hello");
  });

  it("strips the prefix back off for display (round-trip)", () => {
    const original = "add a tasks section";
    expect(stripNoteContext(withNoteContext(original, "n.md"))).toBe(original);
  });

  it("strips fully even when the note path contains a ]", () => {
    const out = withNoteContext("hi", "weird]name.md");
    expect(out).toContain("./vault/weird]name.md");
    expect(stripNoteContext(out)).toBe("hi");
  });

  it("leaves a plain message untouched", () => {
    expect(stripNoteContext("just a normal message")).toBe("just a normal message");
  });

  it("does not strip a bracketed message that isn't a context prefix", () => {
    const text = "[TODO] buy milk\n\nand bread";
    expect(stripNoteContext(text)).toBe(text);
  });
});
