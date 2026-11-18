import { describe, expect, it } from "vitest";

import { inlineTagSpans } from "./tag-grammar";

const tagsIn = (text: string) => inlineTagSpans(text).map(({ tag }) => tag);

describe("an inline tag", () => {
  it("pulls `#tag` tokens from prose", () => {
    expect(tagsIn("A note about #project and #ideas here.")).toStrictEqual(["project", "ideas"]);
  });

  it("requires a letter first — excludes `#123` and fully-numeric hex", () => {
    expect(tagsIn("issue #123 and #456789 not tags")).toStrictEqual([]);
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

  it("keeps unicode letter tags", () => {
    expect(tagsIn("café notes #café and #日本語")).toStrictEqual(["café", "日本語"]);
  });
});
