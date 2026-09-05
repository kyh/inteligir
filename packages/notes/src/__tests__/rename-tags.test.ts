import { describe, expect, it } from "vitest";

import { documentTagSpans, isTagName, scanDoc } from "../knowledge/link-extract";
import { computeTagRenameEdits, renamedTag, renameTagsInDoc } from "../knowledge/rename-tags";

describe("the tag name a rename accepts", () => {
  it("is the inline grammar's name", () => {
    for (const name of ["project", "area/deep-dive", "v2_final", "Ünïcode"]) {
      expect(isTagName(name)).toBe(true);
    }
    for (const name of ["", "#project", "123", "a/", "/a", "a b", "a//b", "-x"]) {
      expect(isTagName(name)).toBe(false);
    }
  });
});

describe("which tags a rename moves", () => {
  it("moves the tag and its nested family, matched case-insensitively, spelled as asked", () => {
    expect(renamedTag("project", "project", "work")).toBe("work");
    expect(renamedTag("Project", "project", "Work")).toBe("Work");
    expect(renamedTag("project/alpha", "project", "work")).toBe("work/alpha");
    expect(renamedTag("projects", "project", "work")).toBeNull();
    expect(renamedTag("other", "project", "work")).toBeNull();
  });
});

describe("document tag spans", () => {
  it("names the bytes of every inline tag the index reads, and nothing it does not", () => {
    const src =
      "Text #one and `#two` inline.\n\n```\n#three in a fence\n```\n\n[a #four](x.md) then #five/six.\n";
    const spans = documentTagSpans(src);
    expect(spans.map((span) => span.tag)).toEqual(["one", "five/six"]);
    for (const span of spans) {
      expect(src.slice(span.start, span.end)).toBe(`#${span.tag}`);
    }
    expect(scanDoc(src).tags).toEqual(["one", "five/six"]);
  });
});

describe("renaming a tag in one doc", () => {
  it("rewrites inline tags and frontmatter tags, byte-exact elsewhere", () => {
    const src = [
      "---",
      "title: Plan",
      "tags: [project, '#project/alpha', other]",
      "status: draft",
      "---",
      "",
      "# Plan",
      "",
      "Work on #project and #Project/beta, not #projects or `#project`.",
      "",
    ].join("\n");
    const out = renameTagsInDoc(src, "project", "work");
    expect(out).toContain("Work on #work and #work/beta, not #projects or `#project`.");
    expect(out).toContain("title: Plan");
    expect(out).toContain("status: draft");
    expect(scanDoc(out).tags).toEqual([
      "work",
      "work/alpha",
      "other",
      "work",
      "work/beta",
      "projects",
    ]);
  });

  it("leaves a doc without the tag untouched, bytes included", () => {
    const src = "---\ntags: [other]\n---\n\nNothing about #else here.\n";
    expect(renameTagsInDoc(src, "project", "work")).toBe(src);
  });

  it("leaves invalid frontmatter alone and still rewrites the body", () => {
    const src = "---\ntags: [unclosed\n---\n\n#project here.\n";
    const out = renameTagsInDoc(src, "project", "work");
    expect(out.startsWith("---\ntags: [unclosed\n---\n")).toBe(true);
    expect(out).toContain("#work here.");
  });
});

describe("the edit set", () => {
  it("holds only the docs that changed, and nothing for a rename to itself", () => {
    const docs = new Map([
      ["a.md", "#project one\n"],
      ["b.md", "no tags\n"],
    ]);
    expect([...computeTagRenameEdits(docs, "project", "work").keys()]).toEqual(["a.md"]);
    expect(computeTagRenameEdits(docs, "project", "project").size).toBe(0);
  });
});
