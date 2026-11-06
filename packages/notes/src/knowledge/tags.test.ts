import { describe, expect, it } from "vitest";

import { frontmatterTags } from "./link-extract";
import { inlineTagSpans } from "./tag-grammar";

const tagsIn = (text: string): string[] => inlineTagSpans(text).map(({ tag }) => tag);

describe("an inline tag", () => {
  it("pulls `#tag` tokens from prose", () => {
    expect(tagsIn("A note about #project and #ideas here.")).toEqual(["project", "ideas"]);
  });

  it("requires a letter first — excludes `#123` and fully-numeric hex", () => {
    expect(tagsIn("issue #123 and #456789 not tags")).toEqual([]);
  });

  it("allows nested `a/b` tags and dashes, not a trailing separator", () => {
    expect(tagsIn("#area/deep-dive and #foo/ and #bar-")).toEqual(["area/deep-dive", "foo", "bar"]);
  });

  it("does not match `#` glued to a preceding word char (C#, ##h) or a url's fragment", () => {
    expect(tagsIn("C# rocks and a ##heading marker, https://example.com/x#frag")).toEqual([]);
  });

  it("keeps unicode letter tags", () => {
    expect(tagsIn("café notes #café and #日本語")).toEqual(["café", "日本語"]);
  });
});

describe("frontmatter tags", () => {
  it("reads the `tags` array in order", () => {
    expect(frontmatterTags("tags:\n  - meta\n  - demo\n")).toEqual(["meta", "demo"]);
  });

  it("tolerates and strips a leading `#`", () => {
    expect(frontmatterTags('tags: ["#alpha", beta]\n')).toEqual(["alpha", "beta"]);
  });

  it("reads a lone string as one tag, as aliases do", () => {
    expect(frontmatterTags("tags: single\n")).toEqual(["single"]);
    expect(frontmatterTags("tags: '#hashed'\n")).toEqual(["hashed"]);
  });

  it("reads only what an inline `#` could spell", () => {
    expect(frontmatterTags("tags: [2026, reading list, ok]\n")).toEqual(["ok"]);
    expect(frontmatterTags('tags: ["2026", ok]\n')).toEqual(["ok"]);
    expect(frontmatterTags("tags: 2026\n")).toEqual([]);
    expect(frontmatterTags(": [\n")).toEqual([]);
  });
});
