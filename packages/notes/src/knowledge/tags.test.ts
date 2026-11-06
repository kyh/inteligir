import { describe, expect, it } from "vitest";

import { scanDoc } from "./link-extract";

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

  it("reads an alert's body as the markdown the editor renders", () => {
    const src = [
      "Before #outer.",
      "",
      "> [!NOTE]",
      "> Inside #inner and `#code`, [a #label](x.md).",
      "",
      "```js",
      "#not-a-callout",
      "```",
      "",
    ].join("\n");
    expect(tagsOf(src)).toEqual(["outer", "inner"]);
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

  it("reads a lone string as one tag, as aliases do", () => {
    expect(tagsOf("---\ntags: single\n---\n\nBody #inline\n")).toEqual(["single", "inline"]);
    expect(tagsOf("---\ntags: '#hashed'\n---\n")).toEqual(["hashed"]);
  });

  it("indexes only what an inline `#` could spell", () => {
    expect(tagsOf("---\ntags: [2026, reading list, ok]\n---\n")).toEqual(["ok"]);
    expect(tagsOf('---\ntags: ["2026", ok]\n---\n')).toEqual(["ok"]);
    expect(tagsOf("---\ntags: 2026\n---\n")).toEqual([]);
  });
});
