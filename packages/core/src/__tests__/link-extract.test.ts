import { describe, expect, it } from "vitest";

import { scanDoc, titleFromPath, type ExtractedLink } from "../knowledge/link-extract";

function links(source: string): ExtractedLink[] {
  return scanDoc(source).links;
}

function only(source: string): ExtractedLink {
  const all = links(source);
  expect(all).toHaveLength(1);
  const first = all[0];
  if (!first) throw new Error("unreachable");
  return first;
}

/** The span/targetSpan contract: slicing the source re-derives the bytes. */
function sliceTarget(source: string, link: ExtractedLink): string | null {
  return link.targetSpan ? source.slice(link.targetSpan.start, link.targetSpan.end) : null;
}

describe("scanDoc — wiki links", () => {
  it("extracts a plain wiki link with verified spans", () => {
    const src = "before [[target note]] after\n";
    const link = only(src);
    expect(link).toMatchObject({ kind: "wiki", embed: false, target: "target note", line: 1 });
    expect(src.slice(link.span.start, link.span.end)).toBe("[[target note]]");
    expect(sliceTarget(src, link)).toBe("target note");
  });

  it("splits alias and anchor, keeping the target span exact", () => {
    const src = "x [[note#sec|friendly]] y";
    const link = only(src);
    expect(link).toMatchObject({ target: "note", anchor: "sec", alias: "friendly" });
    expect(sliceTarget(src, link)).toBe("note");
  });

  it("keeps padding out of the target span", () => {
    const src = "a [[ padded ]] b";
    const link = only(src);
    expect(link.target).toBe("padded");
    expect(sliceTarget(src, link)).toBe("padded");
  });

  it("marks ![[embeds]] as transclusions", () => {
    const src = "see ![[target note]]";
    const link = only(src);
    expect(link.embed).toBe(true);
    expect(src.slice(link.span.start, link.span.end)).toBe("![[target note]]");
    expect(sliceTarget(src, link)).toBe("target note");
  });

  it("handles unicode targets", () => {
    const src = "看 [[héllo wörld]] 完";
    const link = only(src);
    expect(link.target).toBe("héllo wörld");
    expect(sliceTarget(src, link)).toBe("héllo wörld");
  });

  it("ignores links inside fenced code, inline code, and indented code", () => {
    const src = [
      "```",
      "[[fenced]]",
      "```",
      "",
      "some `[[inline code]]` here",
      "",
      "    [[indented code]]",
      "",
    ].join("\n");
    expect(links(src)).toHaveLength(0);
  });

  it("ignores escaped brackets", () => {
    expect(links("\\[\\[not a link]]")).toHaveLength(0);
  });

  it("skips pure-anchor same-file links", () => {
    expect(links("see [[#section]]")).toHaveLength(0);
  });

  it("finds links inside GFM table cells and blockquotes", () => {
    const src = "| a |\n| - |\n| [[in table]] |\n\n> quoted [[in quote]]\n";
    expect(links(src).map((l) => l.target)).toEqual(["in table", "in quote"]);
  });

  it("does not scan frontmatter", () => {
    const src = "---\ntitle: [[not a link]]\n---\n\nbody [[real]]\n";
    expect(links(src).map((l) => l.target)).toEqual(["real"]);
  });

  it("reports 1-based lines", () => {
    const src = "line one\n\n[[on line three]]\n";
    expect(only(src).line).toBe(3);
  });
});

describe("scanDoc — standard md links", () => {
  it("extracts a relative md link with the url as target span", () => {
    const src = "read [the note](notes/other.md) now";
    const link = only(src);
    expect(link).toMatchObject({ kind: "md", target: "notes/other.md", alias: "the note" });
    expect(sliceTarget(src, link)).toBe("notes/other.md");
  });

  it("excludes the fragment from the target span", () => {
    const src = "[t](note.md#section)";
    const link = only(src);
    expect(link).toMatchObject({ target: "note.md", anchor: "section" });
    expect(sliceTarget(src, link)).toBe("note.md");
  });

  it("percent-decodes the target but records the raw span", () => {
    const src = "[t](my%20note.md)";
    const link = only(src);
    expect(link.target).toBe("my note.md");
    expect(sliceTarget(src, link)).toBe("my%20note.md");
  });

  it("handles angle-bracket destinations (span excludes the brackets)", () => {
    const src = "[t](<my note.md>)";
    const link = only(src);
    expect(link.target).toBe("my note.md");
    expect(sliceTarget(src, link)).toBe("my note.md");
  });

  it("accepts extension-less urls (`.md` implied at resolution)", () => {
    expect(only("[t](note)").target).toBe("note");
  });

  it("skips external, protocol-relative, and same-file fragment urls", () => {
    const src = [
      "[a](https://example.com/x.md)",
      "[b](mailto:a@b.c)",
      "[c](//cdn.example.com/x.md)",
      "[d](#heading)",
    ].join(" ");
    expect(links(src)).toHaveLength(0);
  });

  it("skips images and asset links", () => {
    expect(links("![alt](diagram.png) and [pdf](paper.pdf)")).toHaveLength(0);
  });

  it("extracts reference definitions", () => {
    const src = "[text][ref]\n\n[ref]: notes/other.md\n";
    const all = links(src);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ kind: "md", target: "notes/other.md" });
    expect(all[0] ? sliceTarget(src, all[0]) : null).toBe("notes/other.md");
  });

  it("extracts a wiki link nested in an md link label", () => {
    const src = "[[inner]] and [label](outer.md)";
    expect(links(src).map((l) => l.target)).toEqual(["inner", "outer.md"]);
  });
});

describe("scanDoc — title and headings", () => {
  it("takes the first h1 as title and collects all headings", () => {
    const scan = scanDoc("# Top\n\n## Sub one\n\ntext\n\n### Sub two\n\n# Second h1\n");
    expect(scan.title).toBe("Top");
    expect(scan.headings).toEqual(["Top", "Sub one", "Sub two", "Second h1"]);
  });

  it("returns null title when there is no h1", () => {
    expect(scanDoc("## only a subheading\n").title).toBeNull();
  });
});

describe("titleFromPath", () => {
  it("strips directories and the extension", () => {
    expect(titleFromPath("notes/my note.md")).toBe("my note");
    expect(titleFromPath("plain")).toBe("plain");
  });
});
