import { describe, expect, it } from "vitest";

import { scanDoc, type ExtractedLink } from "../knowledge/link-extract";
import { scanTaskItems } from "../knowledge/task-ordinal";

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

function sliceTarget(source: string, link: ExtractedLink): string | null {
  return link.targetSpan ? source.slice(link.targetSpan.start, link.targetSpan.end) : null;
}

describe("scanDoc — wiki links", () => {
  it("extracts a plain wiki link with a verified target span", () => {
    const src = "before [[target note]] after\n";
    const link = only(src);
    expect(link).toMatchObject({ kind: "wiki", embed: false, target: "target note", line: 1 });
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
    expect(sliceTarget(src, link)).toBe("target note");
  });

  it("handles unicode targets", () => {
    const src = "看 [[héllo wörld]] 完";
    const link = only(src);
    expect(link.target).toBe("héllo wörld");
    expect(sliceTarget(src, link)).toBe("héllo wörld");
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

  it("extracts asset links as md links (rename safety beats note-only graphs)", () => {
    const src = "[pdf](paper.pdf)";
    const link = only(src);
    expect(link).toMatchObject({ kind: "md", embed: false, target: "paper.pdf", alias: "pdf" });
    expect(sliceTarget(src, link)).toBe("paper.pdf");
  });

  it("extracts reference definitions", () => {
    const src = "[text][ref]\n\n[ref]: notes/other.md\n";
    const all = links(src);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ kind: "md", target: "notes/other.md" });
    expect(all[0] ? sliceTarget(src, all[0]) : null).toBe("notes/other.md");
  });

  it("extracts asset-target reference definitions", () => {
    const src = "![shot][ref]\n\n[ref]: img/shot.png\n";
    const all = links(src);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ kind: "md", target: "img/shot.png" });
    expect(all[0] ? sliceTarget(src, all[0]) : null).toBe("img/shot.png");
  });

  it("extracts a wiki link nested in an md link label", () => {
    const src = "[[inner]] and [label](outer.md)";
    expect(links(src).map((l) => l.target)).toEqual(["inner", "outer.md"]);
  });
});

describe("scanDoc — md images", () => {
  it("extracts an image as a distinct embed kind with alt as alias", () => {
    const src = "see ![a diagram](img/diagram.png) here";
    const link = only(src);
    expect(link).toMatchObject({
      kind: "image",
      embed: true,
      target: "img/diagram.png",
      alias: "a diagram",
      line: 1,
    });
    expect(sliceTarget(src, link)).toBe("img/diagram.png");
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
    expect(sliceTarget(src, link)).toBe("my%20pic.png");
  });

  it("handles angle-bracket destinations (span excludes the brackets)", () => {
    const src = "![x](<my pic.png>)";
    const link = only(src);
    expect(link.target).toBe("my pic.png");
    expect(sliceTarget(src, link)).toBe("my pic.png");
  });

  it("locates the destination past a bracketed alt", () => {
    const src = "![see [inner] note](pic.png)";
    const link = only(src);
    expect(link.target).toBe("pic.png");
    expect(sliceTarget(src, link)).toBe("pic.png");
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

describe("scanDoc — task extraction", () => {
  it("extracts every GFM task item in ordinal order, with its line and text", () => {
    const src = [
      "# Plan",
      "",
      "- [ ] book the flight",
      "- [x] already done",
      "  - [ ] nested child",
      "",
      "* [ ] **bold** star item",
    ].join("\n");
    const tasks = scanDoc(src).tasks;
    expect(tasks).toEqual([
      { checked: false, text: "book the flight", line: 3 },
      { checked: true, text: "already done", line: 4 },
      { checked: false, text: "nested child", line: 5 },
      { checked: false, text: "**bold** star item", line: 7 },
    ]);
  });

  it("counts a task on a CRLF file at its own line", () => {
    const tasks = scanDoc("# H\r\n\r\n- [ ] crlf task\r\n").tasks;
    expect(tasks).toEqual([{ checked: false, text: "crlf task", line: 3 }]);
  });

  it("skips plain bullets, empty checkboxes, and fenced lookalikes — but counts an indented item", () => {
    const src = [
      "- plain bullet",
      "- [ ] ",
      "",
      "```",
      "- [ ] fenced lookalike",
      "```",
      "",
      "    - [ ] indented live task",
      "",
      "- [ ] the real one",
    ].join("\n");
    const tasks = scanDoc(src).tasks;
    expect(tasks.map((t) => [t.text, t.line])).toEqual([
      ["indented live task", 8],
      ["the real one", 10],
    ]);
  });

  it("frontmatter `tasks: false` suppresses extraction (scanTaskItems still counts)", () => {
    const src = "---\ntasks: false\n---\n\n- [ ] hidden from the view\n";
    expect(scanDoc(src).tasks).toEqual([]);
    expect(scanTaskItems(src).map((t) => t.text)).toEqual(["hidden from the view"]);
  });

  it("only an explicit checkbox false opts out", () => {
    expect(scanDoc("---\ntasks: true\n---\n\n- [ ] a\n").tasks).toHaveLength(1);
    expect(scanDoc("---\ntasks: maybe\n---\n\n- [ ] a\n").tasks).toHaveLength(1);
    expect(scanDoc("---\n: bad yaml [\n---\n\n- [ ] a\n").tasks).toHaveLength(1);
  });

  it("never counts checkbox-shaped lines inside YAML frontmatter", () => {
    const src = ["---", "notes:", "  - [ ] yaml lookalike", "---", "", "- [ ] real"].join("\n");
    const tasks = scanDoc(src).tasks;
    expect(tasks.map((t) => [t.text, t.line])).toEqual([["real", 6]]);
  });

  it("leaves tags/links extraction unchanged on task-bearing docs (regression)", () => {
    const scan = scanDoc("- [ ] follow up on [[target note]] #urgent\n");
    expect(scan.links.map((l) => l.target)).toEqual(["target note"]);
    expect(scan.tags).toEqual(["urgent"]);
  });
});

describe("callout fence bodies (editor ⊆ vault)", () => {
  it("indexes wiki links inside a callout body with outer-source spans", () => {
    const source = "# T\n\n```inteligir-callout\ninfo\nSee [[Target Note]] here.\n```\n";
    const scan = scanDoc(source);
    const link = scan.links.find((row) => row.target === "Target Note");
    expect(link).toBeDefined();
    if (link === undefined || link.targetSpan === undefined) throw new Error("no span");
    expect(source.slice(link.targetSpan.start, link.targetSpan.end)).toBe("Target Note");
  });

  it("skips the priority level header line in span math", () => {
    const source = "```inteligir-callout\npriority\nhigh\n[[Deep Link]]\n```\n";
    const scan = scanDoc(source);
    const link = scan.links.find((row) => row.target === "Deep Link");
    expect(link).toBeDefined();
    if (link === undefined || link.targetSpan === undefined) throw new Error("no span");
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
  const cases: Array<[string, string]> = [
    ["raw html", "<div>[[Alpha]]</div>\n"],
    ["inline math", "cost $$[[Alpha]]$$ here\n"],
    ["display math", "$$\n[[Alpha]]\n$$\n"],
    ["an mdx expression", "{foo [[Alpha]] bar}\n"],
  ];

  it.each(cases)("indexes a wiki link inside %s with no span", (_name, source) => {
    const link = only(source);
    expect(link.target).toBe("Alpha");
    expect(link.targetSpan).toBeUndefined();
  });

  it("suppresses an md link's span inside raw html too", () => {
    const link = only("<div>[img](a/img.png)</div>\n");
    expect(link.target).toBe("a/img.png");
    expect(link.targetSpan).toBeUndefined();
  });

  it("keeps the span inside a modelled component — only unmodellable tags go verbatim", () => {
    const src = '<callout kind="note">\n\n[[Alpha]]\n\n</callout>\n';
    const link = only(src);
    expect(sliceTarget(src, link)).toBe("Alpha");
  });

  it("keeps the span when the editor's grammar refuses the doc (it opens Raw)", () => {
    const src = "<mal <tag [[Alpha]]\n";
    const link = only(src);
    expect(sliceTarget(src, link)).toBe("Alpha");
  });
});
