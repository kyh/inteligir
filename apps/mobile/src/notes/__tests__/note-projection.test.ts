import { describe, expect, it } from "vitest";
import { projectNote, type InlineSpan, type NoteBlock } from "../note-projection";

// The projection IS the mobile renderer's contract: what these pin is that a
// note's dialect constructs reach the screen as typed blocks — and that the
// plumbing (comment markers, frontmatter, opaque html) never leaks as text.

function noteBlocks(content: string): NoteBlock[] {
  const projection = projectNote("notes/test.md", content);
  if (projection.kind !== "note") throw new Error(`expected note, got ${projection.kind}`);
  return projection.blocks;
}

function allText(spans: readonly InlineSpan[]): string {
  return spans.map((span) => (span.kind === "text" ? span.text : span.label)).join("");
}

describe("projectNote", () => {
  it("titles from the path and folds frontmatter away", () => {
    const projection = projectNote("notes/Weekly Plan.md", "---\nid: abc\ntags: [x]\n---\n# Hi\n");
    expect(projection.kind).toBe("note");
    expect(projection.title).toBe("Weekly Plan");
    if (projection.kind !== "note") return;
    expect(projection.blocks).toEqual([
      { kind: "heading", depth: 1, spans: [{ kind: "text", text: "Hi" }] },
    ]);
  });

  it("projects headings, paragraphs, tasks and ordered items", () => {
    const blocks = noteBlocks(
      "## Two\n\nBody text.\n\n- [x] done\n- [ ] open\n\n1. first\n2. second\n",
    );
    expect(blocks).toEqual([
      { kind: "heading", depth: 2, spans: [{ kind: "text", text: "Two" }] },
      { kind: "paragraph", spans: [{ kind: "text", text: "Body text." }] },
      {
        kind: "list-item",
        depth: 0,
        ordinal: null,
        checked: true,
        spans: [{ kind: "text", text: "done" }],
      },
      {
        kind: "list-item",
        depth: 0,
        ordinal: null,
        checked: false,
        spans: [{ kind: "text", text: "open" }],
      },
      {
        kind: "list-item",
        depth: 0,
        ordinal: 1,
        checked: null,
        spans: [{ kind: "text", text: "first" }],
      },
      {
        kind: "list-item",
        depth: 0,
        ordinal: 2,
        checked: null,
        spans: [{ kind: "text", text: "second" }],
      },
    ]);
  });

  it("renders wiki links as chips with the dialect's own alias/anchor rules", () => {
    const blocks = noteBlocks("See [[Plans|the plan]] and [[Notes#Goals]] and [[Inbox]].\n");
    const paragraph = blocks[0];
    if (paragraph?.kind !== "paragraph") throw new Error("expected a paragraph");
    const chips = paragraph.spans.filter((span) => span.kind === "wiki-link");
    expect(chips).toEqual([
      { kind: "wiki-link", target: "Plans", label: "the plan" },
      { kind: "wiki-link", target: "Notes", label: "Notes#Goals" },
      { kind: "wiki-link", target: "Inbox", label: "Inbox" },
    ]);
  });

  it("never leaks comment markers, and shows a formula's display half", () => {
    const blocks = noteBlocks("%%i:abc:start%%Priced at {{=A1*2|$12}} today.%%i:abc:end%%\n");
    const paragraph = blocks[0];
    if (paragraph?.kind !== "paragraph") throw new Error("expected a paragraph");
    const rendered = allText(paragraph.spans);
    expect(rendered).toBe("Priced at $12 today.");
    expect(rendered).not.toContain("%%");
  });

  it("recurses into a callout and keeps wiki links live inside it", () => {
    const blocks = noteBlocks("```inteligir-callout\nwarning\nMind the [[Ledger]].\n```\n");
    expect(blocks).toHaveLength(1);
    const callout = blocks[0];
    if (callout?.kind !== "callout") throw new Error("expected a callout");
    expect(callout.label).toBe("warning");
    const inner = callout.blocks[0];
    if (inner?.kind !== "paragraph") throw new Error("expected a paragraph inside");
    expect(inner.spans).toContainEqual({ kind: "wiki-link", target: "Ledger", label: "Ledger" });
  });

  it("reads the callout header with the dialect's own grammar — prefixes and levels", () => {
    const blocks = noteBlocks(
      "```inteligir-callout\ntype: priority\nlevel: high\nShip [[Plans]] first.\n```\n",
    );
    const callout = blocks[0];
    if (callout?.kind !== "callout") throw new Error("expected a callout");
    // The level line is HEADER, never body prose — the drift a second parser
    // had before the grammar moved into @repo/notes.
    expect(callout.label).toBe("priority · high");
    const inner = callout.blocks[0];
    if (inner?.kind !== "paragraph") throw new Error("expected a paragraph inside");
    expect(inner.spans.some((span) => span.kind === "text" && span.text.includes("level"))).toBe(
      false,
    );
  });

  it("renders an unknown callout kind as a plain code block — the dialect's own fallback", () => {
    const blocks = noteBlocks("```inteligir-callout\nnot-a-kind\nbody\n```\n");
    expect(blocks).toEqual([{ kind: "code", lang: "inteligir-callout", text: "not-a-kind\nbody" }]);
  });

  it("answers rich payload fences as honest unsupported cards", () => {
    const blocks = noteBlocks('```inteligir-chart\n{"type":"bar"}\n```\n');
    expect(blocks).toEqual([{ kind: "unsupported", label: "Chart" }]);
  });

  it("keeps ordinary code fences verbatim", () => {
    const blocks = noteBlocks("```ts\nconst a = 1;\n```\n");
    expect(blocks).toEqual([{ kind: "code", lang: "ts", text: "const a = 1;" }]);
  });

  it("opens a file the parse refuses RAW, byte-for-byte, with the reason", () => {
    const source = "# fine until\n\n<a></b>\n";
    const projection = projectNote("notes/broken.md", source);
    expect(projection.kind).toBe("raw");
    if (projection.kind !== "raw") return;
    expect(projection.text).toBe(source);
    expect(projection.reason).not.toBe("");
  });
});
