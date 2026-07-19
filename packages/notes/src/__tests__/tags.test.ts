import { describe, expect, it } from "vitest";

import { KnowledgeIndex } from "../knowledge/knowledge-index";
import { scanDoc } from "../knowledge/link-extract";
import { TagIndex } from "../knowledge/tag-index";

const tagsOf = (source: string): string[] => scanDoc(source).tags;

describe("scanDoc — inline tag extraction", () => {
  it("pulls `#tag` tokens from prose", () => {
    expect(tagsOf("A note about #project and #ideas here.\n")).toEqual(["project", "ideas"]);
  });

  it("requires a letter first — excludes `#123` and fully-numeric hex", () => {
    expect(tagsOf("issue #123 and #456789 not tags\n")).toEqual([]);
  });

  it("allows nested `a/b` tags and dashes, not a trailing separator", () => {
    expect(tagsOf("#area/deep-dive and #foo/ and #bar-\n")).toEqual([
      "area/deep-dive",
      "foo",
      "bar",
    ]);
  });

  it("does not match `#` glued to a preceding word char (C#, ##h)", () => {
    expect(tagsOf("C# rocks and a ##heading marker\n")).toEqual([]);
  });

  it("excludes tags inside inline code spans and fenced code", () => {
    const src = "Text `#nope` inline.\n\n```\n#alsonope in a fence\n```\n\nBut #yes counts.\n";
    expect(tagsOf(src)).toEqual(["yes"]);
  });

  it("excludes url fragments and link/image labels", () => {
    const src =
      "See <https://example.com/x#frag> and [a #label](out.md) and ![alt #nope](p.png), but #real here.\n";
    expect(tagsOf(src)).toEqual(["real"]);
  });

  it("finds tags inside emphasis and headings", () => {
    expect(tagsOf("## Topic #inheading\n\nBody with **#bold** tag.\n")).toEqual([
      "inheading",
      "bold",
    ]);
  });

  it("keeps unicode letter tags", () => {
    expect(tagsOf("café notes #café and #日本語\n")).toEqual(["café", "日本語"]);
  });
});

describe("scanDoc — frontmatter tags", () => {
  it("reads the frontmatter `tags` array, then inline tags in order", () => {
    const src = "---\ntags:\n  - meta\n  - demo\n---\n\n# Note\n\nBody #inline here.\n";
    expect(tagsOf(src)).toEqual(["meta", "demo", "inline"]);
  });

  it("tolerates and strips a leading `#` on frontmatter tags", () => {
    const src = '---\ntags: ["#alpha", beta]\n---\n\nBody\n';
    expect(tagsOf(src)).toEqual(["alpha", "beta"]);
  });

  it("ignores a non-array `tags` frontmatter value", () => {
    expect(tagsOf("---\ntags: single\n---\n\nBody #inline\n")).toEqual(["inline"]);
  });
});

describe("TagIndex", () => {
  it("unifies case-insensitively, keeping the first-seen display case", () => {
    const index = new TagIndex();
    index.set("a.md", ["Meta"]);
    index.set("b.md", ["meta"]);
    expect(index.all()).toEqual([{ tag: "Meta", count: 2 }]);
    expect(index.notesWithTag("META")).toEqual(["a.md", "b.md"]);
  });

  it("dedupes per-doc duplicates (frontmatter + inline of the same tag)", () => {
    const index = new TagIndex();
    index.set("a.md", ["meta", "Meta", "meta"]);
    expect(index.all()).toEqual([{ tag: "meta", count: 1 }]);
  });

  it("orders by count desc, then alphabetically", () => {
    const index = new TagIndex();
    index.set("a.md", ["zebra", "alpha"]);
    index.set("b.md", ["alpha"]);
    expect(index.all()).toEqual([
      { tag: "alpha", count: 2 },
      { tag: "zebra", count: 1 },
    ]);
  });

  it("removes a doc's contribution and drops now-empty tags", () => {
    const index = new TagIndex();
    index.set("a.md", ["shared", "onlya"]);
    index.set("b.md", ["shared"]);
    index.remove("a.md");
    expect(index.all()).toEqual([{ tag: "shared", count: 1 }]);
    expect(index.notesWithTag("onlya")).toEqual([]);
  });

  it("re-index replaces the prior tag set for a path", () => {
    const index = new TagIndex();
    index.set("a.md", ["old"]);
    index.set("a.md", ["new"]);
    expect(index.notesWithTag("old")).toEqual([]);
    expect(index.notesWithTag("new")).toEqual(["a.md"]);
  });
});

describe("KnowledgeIndex — tags", () => {
  it("unions inline and frontmatter tags across docs", () => {
    const index = new KnowledgeIndex();
    index.setDoc("a.md", "---\ntags: [meta, demo]\n---\n\n# A\n");
    index.setDoc("b.md", "# B\n\nInline #meta and #project.\n");
    expect(index.tags()).toEqual([
      { tag: "meta", count: 2 },
      { tag: "demo", count: 1 },
      { tag: "project", count: 1 },
    ]);
    expect(index.notesWithTag("meta")).toEqual(["a.md", "b.md"]);
    expect(index.notesWithTag("project")).toEqual(["b.md"]);
  });

  it("drops tags when a doc is removed or becomes a non-doc", () => {
    const index = new KnowledgeIndex();
    index.setDoc("a.md", "#gone\n");
    expect(index.notesWithTag("gone")).toEqual(["a.md"]);
    index.remove("a.md");
    expect(index.notesWithTag("gone")).toEqual([]);

    index.setDoc("b.md", "#toother\n");
    index.setOther("b.md");
    expect(index.notesWithTag("toother")).toEqual([]);
  });
});
