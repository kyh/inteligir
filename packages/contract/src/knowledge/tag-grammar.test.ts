import { describe, expect, it } from "vitest";

import { inlineTagSpans } from "./tag-grammar";

const tagsIn = (text: string) => inlineTagSpans(text).map(({ tag }) => tag);

describe("an inline tag", () => {
  it("pulls `#tag` tokens from prose", () => {
    expect(tagsIn("A note about #project and #ideas here.")).toStrictEqual(["project", "ideas"]);
  });

  it("requires a letter first — excludes `#123` and a hex color, letters and all", () => {
    expect(tagsIn("issue #123, #456789 and #0d6efd not tags")).toStrictEqual([]);
  });

  it("needs a name right after the `#`", () => {
    expect(tagsIn("# heading and a lone # here")).toStrictEqual([]);
  });

  it("allows nested `a/b` tags and dashes, not a trailing separator", () => {
    expect(tagsIn("#area/deep-dive and #foo/ and #bar-")).toStrictEqual([
      "area/deep-dive",
      "foo",
      "bar",
    ]);
  });

  it("does not match `#` glued to a preceding word char (C#, ##h) or a url's fragment", () => {
    expect(tagsIn("C# rocks and a ##heading marker, https://example.com/x#frag")).toStrictEqual([]);
  });

  it("spans from its `#` to the name's end, short of a trailing dash", () => {
    expect(inlineTagSpans("see #alpha and #a/b/c plus #bar-.")).toStrictEqual([
      { end: 10, start: 4, tag: "alpha" },
      { end: 21, start: 15, tag: "a/b/c" },
      { end: 31, start: 27, tag: "bar" },
    ]);
  });

  it("keeps unicode letter tags", () => {
    expect(tagsIn("café notes #café and #日本語")).toStrictEqual(["café", "日本語"]);
  });
});
