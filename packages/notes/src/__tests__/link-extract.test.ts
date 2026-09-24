import type { Nodes } from "mdast";
import { describe, expect, it } from "vitest";

import { documentLinkSpans, mdLinkTarget, scanDoc } from "../knowledge/link-extract";
import type { ExtractedLink } from "../knowledge/link-extract";
import { parseMdast } from "../markdown/parse";

const links = (source: string): ExtractedLink[] => scanDoc(source).links;

const only = (source: string): ExtractedLink => {
  const all = links(source);
  expect(all).toHaveLength(1);
  const [first] = all;
  if (!first) {
    throw new Error("unreachable");
  }
  return first;
};

// the bytes a rename would splice for a source holding one link; null when it is indexed only
const sliceTarget = (source: string): string | null => {
  const spanned = documentLinkSpans(source);
  expect(spanned.length).toBeLessThanOrEqual(1);
  const [first] = spanned;
  return first === undefined ? null : source.slice(first.targetSpan.start, first.targetSpan.end);
};

describe("scanDoc — wiki links", () => {
  it("extracts a plain wiki link with a verified target span", () => {
    const src = "before [[target note]] after\n";
    const link = only(src);
    expect(link).toMatchObject({ embed: false, kind: "wiki", line: 1, target: "target note" });
    expect(sliceTarget(src)).toBe("target note");
  });

  it("splits alias and anchor, keeping the target span exact", () => {
    const src = "x [[note#sec|friendly]] y";
    const link = only(src);
    expect(link).toMatchObject({ alias: "friendly", anchor: "sec", target: "note" });
    expect(sliceTarget(src)).toBe("note");
  });

  it("spans an escaped target over its escaped bytes", () => {
    const src = "x [[Issue\\#42#sec]] y";
    const link = only(src);
    expect(link).toMatchObject({ anchor: "sec", target: "Issue#42" });
    expect(sliceTarget(src)).toBe("Issue\\#42");
  });

  it("keeps padding out of the target span", () => {
    const src = "a [[ padded ]] b";
    const link = only(src);
    expect(link.target).toBe("padded");
    expect(sliceTarget(src)).toBe("padded");
  });

  it("marks ![[embeds]] as transclusions", () => {
    const src = "see ![[target note]]";
    const link = only(src);
    expect(link.embed).toBe(true);
    expect(sliceTarget(src)).toBe("target note");
  });

  it("handles unicode targets", () => {
    const src = "看 [[héllo wörld]] 完";
    const link = only(src);
    expect(link.target).toBe("héllo wörld");
    expect(sliceTarget(src)).toBe("héllo wörld");
  });

  it("ignores links inside fenced code and inline code", () => {
    const src = ["```", "[[fenced]]", "```", "", "some `[[inline code]]` here", ""].join("\n");
    expect(links(src)).toHaveLength(0);
  });

  it("extracts a 4-space-indented link (no indented code in the canonical flavor)", () => {
    const src = "Notes\n\n    [[indented live link]]\n";
    expect(links(src).map((l) => l.target)).toEqual(["indented live link"]);
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
    expect(link).toMatchObject({ alias: "the note", kind: "md", target: "notes/other.md" });
    expect(sliceTarget(src)).toBe("notes/other.md");
  });

  it("excludes the fragment from the target span", () => {
    const src = "[t](note.md#section)";
    const link = only(src);
    expect(link).toMatchObject({ anchor: "section", target: "note.md" });
    expect(sliceTarget(src)).toBe("note.md");
  });

  it("percent-decodes the target but records the raw span", () => {
    const src = "[t](my%20note.md)";
    const link = only(src);
    expect(link.target).toBe("my note.md");
    expect(sliceTarget(src)).toBe("my%20note.md");
  });

  it("handles angle-bracket destinations (span excludes the brackets)", () => {
    const src = "[t](<my note.md>)";
    const link = only(src);
    expect(link.target).toBe("my note.md");
    expect(sliceTarget(src)).toBe("my note.md");
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

  it("extracts asset links as md links (rename safety beats note-only graphs)", () => {
    const src = "[pdf](paper.pdf)";
    const link = only(src);
    expect(link).toMatchObject({ alias: "pdf", embed: false, kind: "md", target: "paper.pdf" });
    expect(sliceTarget(src)).toBe("paper.pdf");
  });

  it("extracts reference definitions", () => {
    const src = "[text][ref]\n\n[ref]: notes/other.md\n";
    const all = links(src);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ kind: "md", target: "notes/other.md" });
    expect(sliceTarget(src)).toBe("notes/other.md");
  });

  it("extracts asset-target reference definitions", () => {
    const src = "![shot][ref]\n\n[ref]: img/shot.png\n";
    const all = links(src);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ kind: "md", target: "img/shot.png" });
    expect(sliceTarget(src)).toBe("img/shot.png");
  });

  it("extracts a wiki link nested in an md link label", () => {
    const src = "[[inner]] and [label](outer.md)";
    expect(links(src).map((l) => l.target)).toEqual(["inner", "outer.md"]);
  });

  it("answers mdLinkTarget with the target the scan indexes the url under", () => {
    const urls = [
      "My%20Note.md#top",
      "../../a/x%20y.png",
      "bad%zz.md",
      "note",
      "https://example.com/x.md",
      "mailto:a@b.c",
      "//cdn.example.com/x.md",
      "#heading",
    ];
    for (const url of urls) {
      expect(mdLinkTarget(url), url).toBe(links(`[t](<${url}>)`).at(0)?.target ?? null);
    }
    expect(mdLinkTarget("My%20Note.md#top")).toBe("My Note.md");
  });
});

describe("scanDoc — md images", () => {
  it("extracts an image as a distinct embed kind with alt as alias", () => {
    const src = "see ![a diagram](img/diagram.png) here";
    const link = only(src);
    expect(link).toMatchObject({
      alias: "a diagram",
      embed: true,
      kind: "image",
      line: 1,
      target: "img/diagram.png",
    });
    expect(sliceTarget(src)).toBe("img/diagram.png");
  });

  it("omits the alias for an empty alt", () => {
    const link = only("![](shot.png)");
    expect(link.alias).toBeUndefined();
    expect(link.target).toBe("shot.png");
  });

  it("percent-decodes the target but records the raw span", () => {
    const src = "![x](my%20pic.png)";
    const link = only(src);
    expect(link.target).toBe("my pic.png");
    expect(sliceTarget(src)).toBe("my%20pic.png");
  });

  it("handles angle-bracket destinations (span excludes the brackets)", () => {
    const src = "![x](<my pic.png>)";
    const link = only(src);
    expect(link.target).toBe("my pic.png");
    expect(sliceTarget(src)).toBe("my pic.png");
  });

  it("locates the destination past a bracketed alt", () => {
    const src = "![see [inner] note](pic.png)";
    const link = only(src);
    expect(link.target).toBe("pic.png");
    expect(sliceTarget(src)).toBe("pic.png");
  });

  it("skips external image urls", () => {
    expect(links("![x](https://example.com/pic.png)")).toHaveLength(0);
  });

  it("ignores images inside fenced code", () => {
    expect(links("```\n![x](pic.png)\n```\n")).toHaveLength(0);
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

describe("scanDoc — frontmatter aliases", () => {
  it("extracts the canonical string-array form in declaration order", () => {
    const src = "---\naliases:\n  - Retro\n  - Post-mortem\n---\n\n# Retrospective\n";
    expect(scanDoc(src).aliases).toEqual(["Retro", "Post-mortem"]);
  });

  it("accepts the single-string scalar and the legacy alias: key (Obsidian interop)", () => {
    expect(scanDoc("---\naliases: Retro\n---\nbody\n").aliases).toEqual(["Retro"]);
    expect(scanDoc("---\nalias: Retro\n---\nbody\n").aliases).toEqual(["Retro"]);
    expect(scanDoc("---\naliases: [A]\nalias: B\n---\nbody\n").aliases).toEqual(["A"]);
    expect(scanDoc("---\naliases: 2026-07-15\n---\nbody\n").aliases).toEqual(["2026-07-15"]);
  });

  it("trims, drops empties, and dedupes case-insensitively keeping first display case", () => {
    const src = "---\naliases:\n  - ' Padded '\n  - ''\n  - padded\n  - Other\n---\nbody\n";
    expect(scanDoc(src).aliases).toEqual(["Padded", "Other"]);
  });

  it("degrades malformed or non-string values to []", () => {
    expect(scanDoc("---\naliases: 42\n---\nbody\n").aliases).toEqual([]);
    expect(scanDoc("---\naliases:\n  - 1\n  - 2\n---\nbody\n").aliases).toEqual([]);
    expect(scanDoc("---\naliases: {a: b}\n---\nbody\n").aliases).toEqual([]);
    expect(scanDoc("---\n: bad yaml [\n---\nbody\n").aliases).toEqual([]);
    expect(scanDoc("no frontmatter\n").aliases).toEqual([]);
  });
});

const editorWikiBodies = (source: string): string[] => {
  const parsed = parseMdast(source);
  if (!parsed.ok) {
    throw new Error(`the editor's grammar refused the fixture: ${parsed.failure.message}`);
  }
  const bodies: string[] = [];
  const walk = (node: Nodes): void => {
    if (node.type === "wikiLink") {
      bodies.push(node.body);
    }
    if ("children" in node) {
      for (const child of node.children) {
        walk(child);
      }
    }
  };
  walk(parsed.root);
  return bodies;
};

// CommonMark's indented code and flow html would split the two grammars here, each hiding from
// the index prose the editor draws, links and tags included
describe("the scan reads as prose what the editor draws as prose", () => {
  it.each([
    ["a 4-space-indented line", "Notes\n\n    [[Alpha]] and #indented\n"],
    ["a line under flow html", "<div>x</div>\n[[Alpha]] and #under\n"],
  ])("agrees on %s", (_name, source) => {
    expect(editorWikiBodies(source)).toEqual(["Alpha"]);
    const scan = scanDoc(source);
    expect(scan.links.map((link) => link.target)).toEqual(["Alpha"]);
    expect(scan.tags).toHaveLength(1);
  });
});

describe("scanDoc — task-bearing docs", () => {
  it("leaves tags/links extraction unchanged on task-bearing docs (regression)", () => {
    const scan = scanDoc("- [ ] follow up on [[target note]] #urgent\n");
    expect(scan.links.map((l) => l.target)).toEqual(["target note"]);
    expect(scan.tags).toEqual(["urgent"]);
  });
});

describe("callout fence bodies (editor ⊆ vault)", () => {
  it("indexes wiki links inside a callout body with outer-source spans", () => {
    const source = "# T\n\n```inteligir-callout\ninfo\nSee [[Target Note]] here.\n```\n";
    const link = documentLinkSpans(source).find((row) => row.target === "Target Note");
    if (link === undefined) {
      throw new Error("no span");
    }
    expect(source.slice(link.targetSpan.start, link.targetSpan.end)).toBe("Target Note");
  });

  it("skips the priority level header line in span math", () => {
    const source = "```inteligir-callout\npriority\nhigh\n[[Deep Link]]\n```\n";
    const link = documentLinkSpans(source).find((row) => row.target === "Deep Link");
    if (link === undefined) {
      throw new Error("no span");
    }
    expect(source.slice(link.targetSpan.start, link.targetSpan.end)).toBe("Deep Link");
  });

  it("refuses an indented fence rather than mis-indexing it", () => {
    const source = "- item\n\n  ```inteligir-callout\n  info\n  [[Hidden]]\n  ```\n";
    const scan = scanDoc(source);
    expect(scan.links.find((row) => row.target === "Hidden")).toBeUndefined();
  });

  it("plain code fences stay unindexed", () => {
    const scan = scanDoc("```\n[[Not A Link]]\n```\n");
    expect(scan.links).toEqual([]);
  });
});

describe("verbatim regions (indexed, never rewritten)", () => {
  it("emits no span on the index path, which never reads the verbatim ranges", () => {
    const [link] = scanDoc("[[Alpha]] and [b](b.md)\n").links;
    expect(link).toBeDefined();
    expect(link).not.toHaveProperty("targetSpan");
  });

  const cases: [string, string][] = [
    ["raw html", "<div>[[Alpha]]</div>\n"],
    ["inline math", "cost $$[[Alpha]]$$ here\n"],
    ["display math", "$$\n[[Alpha]]\n$$\n"],
    ["an mdx expression", "{foo [[Alpha]] bar}\n"],
  ];

  it.each(cases)("indexes a wiki link inside %s with no span", (_name, source) => {
    const link = only(source);
    expect(link.target).toBe("Alpha");
    expect(sliceTarget(source)).toBeNull();
  });

  it("suppresses an md link's span inside raw html too", () => {
    const source = "<div>[img](a/img.png)</div>\n";
    expect(only(source).target).toBe("a/img.png");
    expect(sliceTarget(source)).toBeNull();
  });

  it("keeps the span inside a modelled component — only unmodellable tags go verbatim", () => {
    const src = '<callout kind="note">\n\n[[Alpha]]\n\n</callout>\n';
    only(src);
    expect(sliceTarget(src)).toBe("Alpha");
  });

  it("keeps the span when the editor's grammar refuses the doc (it opens Raw)", () => {
    const src = "<mal <tag [[Alpha]]\n";
    only(src);
    expect(sliceTarget(src)).toBe("Alpha");
  });
});
