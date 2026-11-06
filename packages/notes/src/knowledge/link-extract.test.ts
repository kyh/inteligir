import { describe, expect, it } from "vitest";

import { frontmatterAliases, mdLinkTarget } from "./link-extract";
import { parseProperties } from "../markdown/frontmatter";

describe(mdLinkTarget, () => {
  it("names the path an md url points at, percent-decoded, its anchor left off", () => {
    expect(mdLinkTarget("My%20Note.md#top")).toBe("My Note.md");
    expect(mdLinkTarget("../../a/x%20y.png")).toBe("../../a/x y.png");
    expect(mdLinkTarget("note")).toBe("note");
  });

  it("keeps a url that does not decode as it was written", () => {
    expect(mdLinkTarget("bad%zz.md")).toBe("bad%zz.md");
  });

  it("names nothing for an external, protocol-relative or same-note url", () => {
    for (const url of [
      "https://example.com/x.md",
      "mailto:a@b.c",
      "C:\\notes\\x.md",
      "//cdn.example.com/x.md",
      "#heading",
      "",
    ]) {
      expect(mdLinkTarget(url), url).toBeNull();
    }
  });
});

const aliasesOf = (yaml: string): string[] => frontmatterAliases(parseProperties(yaml));

describe(frontmatterAliases, () => {
  it("reads the canonical string-array form in declaration order", () => {
    expect(aliasesOf("aliases:\n  - Retro\n  - Post-mortem\n")).toStrictEqual([
      "Retro",
      "Post-mortem",
    ]);
  });

  it("accepts the single-string scalar and the legacy alias: key (Obsidian interop)", () => {
    expect(aliasesOf("aliases: Retro\n")).toStrictEqual(["Retro"]);
    expect(aliasesOf("alias: Retro\n")).toStrictEqual(["Retro"]);
    expect(aliasesOf("aliases: [A]\nalias: B\n")).toStrictEqual(["A"]);
    expect(aliasesOf("aliases: 2026-07-15\n")).toStrictEqual(["2026-07-15"]);
  });

  it("trims, drops empties, and dedupes case-insensitively keeping first display case", () => {
    expect(aliasesOf("aliases:\n  - ' Padded '\n  - ''\n  - padded\n  - Other\n")).toStrictEqual([
      "Padded",
      "Other",
    ]);
  });

  it("degrades malformed or non-string values to []", () => {
    expect(aliasesOf("aliases: 42\n")).toStrictEqual([]);
    expect(aliasesOf("aliases:\n  - 1\n  - 2\n")).toStrictEqual([]);
    expect(aliasesOf("aliases: {a: b}\n")).toStrictEqual([]);
    expect(aliasesOf(": bad yaml [\n")).toStrictEqual([]);
    expect(frontmatterAliases(null)).toStrictEqual([]);
  });
});
