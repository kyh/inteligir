import { assetMediaType } from "@repo/api/cloud/vault/vault-schema";
import { describe, expect, it } from "vitest";
import { projectNote } from "../note-projection";
import type { InlineSpan, NoteBlock } from "../note-projection";

const noteBlocks = (content: string): NoteBlock[] => {
  const projection = projectNote("notes/test.md", content);
  if (projection.kind !== "note") {
    throw new Error(`expected note, got ${projection.kind}`);
  }
  return projection.blocks;
};

const allText = (spans: readonly InlineSpan[]): string =>
  spans.map((span) => (span.kind === "text" ? span.text : span.label)).join("");

describe("projectNote", () => {
  it("titles from the path and folds frontmatter away", () => {
    const projection = projectNote("notes/Weekly Plan.md", "---\nid: abc\ntags: [x]\n---\n# Hi\n");
    expect(projection.kind).toBe("note");
    expect(projection.title).toBe("Weekly Plan");
    if (projection.kind !== "note") {
      return;
    }
    expect(projection.blocks).toEqual([
      { depth: 1, kind: "heading", spans: [{ kind: "text", text: "Hi" }] },
    ]);
  });

  it("projects headings, paragraphs, tasks and ordered items", () => {
    const blocks = noteBlocks(
      "## Two\n\nBody text.\n\n- [x] done\n- [ ] open\n\n1. first\n2. second\n",
    );
    expect(blocks).toEqual([
      { depth: 2, kind: "heading", spans: [{ kind: "text", text: "Two" }] },
      { kind: "paragraph", spans: [{ kind: "text", text: "Body text." }] },
      {
        checked: true,
        depth: 0,
        kind: "list-item",
        ordinal: null,
        spans: [{ kind: "text", text: "done" }],
      },
      {
        checked: false,
        depth: 0,
        kind: "list-item",
        ordinal: null,
        spans: [{ kind: "text", text: "open" }],
      },
      {
        checked: null,
        depth: 0,
        kind: "list-item",
        ordinal: 1,
        spans: [{ kind: "text", text: "first" }],
      },
      {
        checked: null,
        depth: 0,
        kind: "list-item",
        ordinal: 2,
        spans: [{ kind: "text", text: "second" }],
      },
    ]);
  });

  it("renders wiki links as chips with the dialect's own alias/anchor rules", () => {
    const blocks = noteBlocks("See [[Plans|the plan]] and [[Notes#Goals]] and [[Inbox]].\n");
    const [paragraph] = blocks;
    if (paragraph?.kind !== "paragraph") {
      throw new Error("expected a paragraph");
    }
    const chips = paragraph.spans.filter((span) => span.kind === "wiki-link");
    expect(chips).toEqual([
      { kind: "wiki-link", label: "the plan", target: "Plans" },
      { kind: "wiki-link", label: "Notes#Goals", target: "Notes" },
      { kind: "wiki-link", label: "Inbox", target: "Inbox" },
    ]);
  });

  it("never leaks comment markers, and shows a formula's display half", () => {
    const blocks = noteBlocks("%%i:abc:start%%Priced at {{=A1*2|$12}} today.%%i:abc:end%%\n");
    const [paragraph] = blocks;
    if (paragraph?.kind !== "paragraph") {
      throw new Error("expected a paragraph");
    }
    const rendered = allText(paragraph.spans);
    expect(rendered).toBe("Priced at $12 today.");
    expect(rendered).not.toContain("%%");
  });

  it("recurses into a callout and keeps wiki links live inside it", () => {
    const blocks = noteBlocks("```inteligir-callout\nwarning\nMind the [[Ledger]].\n```\n");
    expect(blocks).toHaveLength(1);
    const [callout] = blocks;
    if (callout?.kind !== "callout") {
      throw new Error("expected a callout");
    }
    expect(callout.label).toBe("warning");
    const [inner] = callout.blocks;
    if (inner?.kind !== "paragraph") {
      throw new Error("expected a paragraph inside");
    }
    expect(inner.spans).toContainEqual({ kind: "wiki-link", label: "Ledger", target: "Ledger" });
  });

  it("reads the callout header with the dialect's own grammar — prefixes and levels", () => {
    const blocks = noteBlocks(
      "```inteligir-callout\ntype: priority\nlevel: high\nShip [[Plans]] first.\n```\n",
    );
    const [callout] = blocks;
    if (callout?.kind !== "callout") {
      throw new Error("expected a callout");
    }
    expect(callout.label).toBe("priority · high");
    const [inner] = callout.blocks;
    if (inner?.kind !== "paragraph") {
      throw new Error("expected a paragraph inside");
    }
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
    if (projection.kind !== "raw") {
      return;
    }
    expect(projection.text).toBe(source);
    expect(projection.reason).not.toBe("");
  });

  it("promotes a lone image embed to an image block, alias as its label", () => {
    expect(noteBlocks("![[media/diagram.png]]\n")).toEqual([
      { kind: "image", label: "media/diagram.png", target: "media/diagram.png" },
    ]);
    expect(noteBlocks("![[media/diagram.png|Architecture]]\n")).toEqual([
      { kind: "image", label: "Architecture", target: "media/diagram.png" },
    ]);
  });

  it("keeps an image embed inside prose as a span, not a broken layout", () => {
    const blocks = noteBlocks("see ![[a.png]] here\n");
    expect(blocks).toHaveLength(1);
    const [paragraph] = blocks;
    if (paragraph?.kind !== "paragraph") {
      throw new Error("expected a paragraph");
    }
    expect(paragraph.spans.map((span) => span.kind)).toEqual(["text", "image-embed", "text"]);
  });

  it("promotes only extensions the asset route actually serves", () => {
    // spelled out, not derived: a derived set could not catch the route allowlist drifting.
    for (const extension of ["png", "jpg", "jpeg", "gif", "webp"]) {
      const blocks = noteBlocks(`![[img.${extension}]]\n`);
      expect(blocks[0]?.kind, extension).toBe("image");
      expect(assetMediaType(`img.${extension}`), extension).not.toBeNull();
    }
  });

  it("renders only what core RN Image can draw — everything else stays a link", () => {
    const svg = noteBlocks("![[diagram.svg]]\n");
    expect(svg).toEqual([
      {
        kind: "paragraph",
        spans: [{ kind: "wiki-link", label: "diagram.svg", target: "diagram.svg" }],
      },
    ]);
    const reference = noteBlocks("[[photo.png]]\n");
    expect(reference).toEqual([
      {
        kind: "paragraph",
        spans: [{ kind: "wiki-link", label: "photo.png", target: "photo.png" }],
      },
    ]);
  });
});
