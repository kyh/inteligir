import { describe, expect, it } from "vitest";

import { documentTagSpans, scanDoc } from "../knowledge/link-extract";
import { inlineTagSpans, isTagName } from "../knowledge/tag-grammar";
import { computeTagRenameEdits, renamedTag, renameTagsInDoc } from "../knowledge/rename-tags";

describe("the tag name a rename accepts", () => {
  it("is the inline grammar's name", () => {
    for (const name of ["project", "area/deep-dive", "v2_final", "Ünïcode", "a-/b"]) {
      expect(isTagName(name)).toBe(true);
    }
    for (const name of ["", "#project", "123", "a/", "/a", "a b", "a//b", "-x", "bar-", "a/b-"]) {
      expect(isTagName(name)).toBe(false);
    }
  });

  it("reads back whole from the inline scan, which drops a trailing dash", () => {
    const [span] = inlineTagSpans("#bar-");
    expect(span?.tag).toBe("bar");
    expect(isTagName(span?.tag ?? "")).toBe(true);
    expect(inlineTagSpans("#a-/b").map((found) => found.tag)).toEqual(["a-/b"]);
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

  it("splices a CRLF note's tags in place, every other byte kept", () => {
    const src = "---\r\ntitle: Plan\r\ntags:\r\n  - project\r\n---\r\n\r\nNo inline tag.\r\n";
    expect(renameTagsInDoc(src, "project", "work")).toBe(
      "---\r\ntitle: Plan\r\ntags:\r\n  - work\r\n---\r\n\r\nNo inline tag.\r\n",
    );
  });

  it("keeps a flow list flow, each scalar's quoting and every comment", () => {
    const src = [
      "---",
      "title: Plan # the plan",
      "tags:  [project,  \"project/alpha\", '#Project', other]  # kept",
      "---",
      "",
    ].join("\n");
    expect(renameTagsInDoc(src, "project", "work")).toBe(
      [
        "---",
        "title: Plan # the plan",
        "tags:  [work,  \"work/alpha\", '#work', other]  # kept",
        "---",
        "",
      ].join("\n"),
    );
  });

  it("renames a lone string, and quotes a name yaml would read as another type", () => {
    expect(renameTagsInDoc("---\ntags: project\n---\n", "project", "work")).toBe(
      "---\ntags: work\n---\n",
    );
    expect(renameTagsInDoc("---\ntags: [project]\n---\n", "project", "true")).toBe(
      '---\ntags: ["true"]\n---\n',
    );
  });

  it("leaves a list entry no inline `#` could spell where it is", () => {
    const src = "---\ntags: [2026, project list, project]\n---\n";
    expect(renameTagsInDoc(src, "project", "work")).toBe(
      "---\ntags: [2026, project list, work]\n---\n",
    );
  });

  it("renames a tag inside a callout's body, which the index lists", () => {
    const src = "```inteligir-callout\nnote\nSee #project/alpha here.\n```\n";
    const out = renameTagsInDoc(src, "project", "work");
    expect(out).toBe("```inteligir-callout\nnote\nSee #work/alpha here.\n```\n");
    expect(scanDoc(out).tags).toEqual(["work/alpha"]);
  });

  it.each([
    ["LF", "\n"],
    ["CRLF", "\r\n"],
  ])("%s past a BOM: changes exactly the tag bytes", (_, eol) => {
    const firstLine = (tag: string): string =>
      [`\uFEFF#${tag} opens, #${tag}/alpha follows, \`#project\` and #projects stay`, ""].join(eol);
    const underFrontmatter = (tag: string): string =>
      ["\uFEFF---", "title: Plan", "tags:", `  - ${tag}`, "---", `Body #${tag}.`, ""].join(eol);
    expect(renameTagsInDoc(firstLine("project"), "project", "work")).toBe(firstLine("work"));
    expect(renameTagsInDoc(underFrontmatter("project"), "project", "work")).toBe(
      underFrontmatter("work"),
    );
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
