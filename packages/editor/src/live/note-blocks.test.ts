import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { TElement } from "platejs";
import { slateNodesToInsertDelta } from "@slate-yjs/core";
import * as Y from "yjs";

import { storableBlockSchema } from "@repo/contract/library/library-nodes";
import type { LibraryBlock } from "@repo/contract/library/library-nodes";

import { blockOfElement } from "@repo/editor/live/element-block";
import { readBlocks, seedDoc } from "@repo/editor/live/note-blocks";
import { sectioned } from "@repo/editor/live/note-section";
import type { NoteBlock } from "@repo/editor/live/note-blocks";
import { noteRoot } from "@repo/editor/live/yjs-binding";
import { schemaPairs, usedPairs } from "../test-support/library-node-pairs";
import { liveEditor, relay, settle } from "../test-support/live-notes";
import { generateDoc } from "../test-support/markdown-doc-generator";
import { readValue } from "../test-support/markdown-meaning";

const FIXTURES = fileURLToPath(new URL("../test-support/fixtures/", import.meta.url));

// what the corpus files never spell: a kept file's sha, which the codec writes as a path, and
// what markdown drops or no fixture holds
const UNSPELLED: TElement[] = [
  { children: [{ text: "" }], sha: "a".repeat(64), type: "img" },
  { children: [{ text: "" }], sha: "b".repeat(64), type: "video" },
  { children: [{ text: "" }], name: "deck.pdf", sha: "c".repeat(64), type: "file" },
  {
    children: [{ text: "" }],
    title: "a title",
    type: "img",
    url: "https://example.com/a.png",
    width: 320,
  },
  {
    children: [
      { text: "under", underline: true },
      {
        children: [{ text: "" }],
        display: "3",
        meta: "number",
        source: "1 + 2",
        type: "formulaPill",
      },
    ],
    type: "p",
  },
  {
    children: [
      { children: [{ children: [{ text: "left" }], type: "p" }], type: "column", width: "40%" },
      { children: [{ children: [{ text: "right" }], type: "p" }], type: "column", width: "60%" },
    ],
    type: "column_group",
  },
  { children: [{ text: "four" }], type: "h4" },
  { children: [{ text: "five" }], type: "h5" },
  { children: [{ text: "six" }], type: "h6" },
];

// the indent list's props, which markdown spells only on a paragraph
const LISTED = {
  checked: true,
  indent: 2,
  listRestart: 3,
  listRestartPolite: 3,
  listStart: 3,
  listStyleType: "todo",
} as const;

// blocks as the library stores them, read the way the cell reads one
const stored = (elements: readonly TElement[], from: string): LibraryBlock[] =>
  elements.map((element, index) => {
    const block = blockOfElement({ ...element, id: `${from}-${String(index)}` });
    if (block === null) {
      throw new Error(`${from} holds a block no store takes: ${element.type}`);
    }
    return block;
  });

const FILES: TElement[] = (["corpus", "frontmatter"] as const).flatMap((dir) =>
  readdirSync(`${FIXTURES}${dir}`)
    .toSorted()
    .flatMap((file) => readValue(readFileSync(`${FIXTURES}${dir}/${file}`, "utf-8"))),
);

const GENERATED: TElement[] = Array.from({ length: 20 }, (_, seed) =>
  readValue(generateDoc(seed)),
).flat();

// one block of each type with every list prop it takes, or its indent alone where it takes no other
const withListProps = (elements: readonly TElement[]): TElement[] =>
  [...new Map(elements.map((element) => [element.type, element])).values()].flatMap((element) =>
    [
      { ...element, ...LISTED },
      { ...element, indent: 1 },
    ]
      .filter((decorated) => storableBlockSchema.safeParse({ ...decorated, id: "x" }).success)
      .slice(0, 1),
  );

// every corpus file, a run of generated notes and what markdown cannot spell
const CORPUS: LibraryBlock[] = [
  ...stored(FILES, "file"),
  ...stored(GENERATED, "gen"),
  ...stored(UNSPELLED, "unspelled"),
  ...stored(withListProps([...FILES, ...GENERATED, ...UNSPELLED]), "listed"),
];

// the corpus in both sections, alternating, so a section is read per block
const SECTIONED: NoteBlock[] = CORPUS.map((block, index) => ({
  block,
  section: index % 3 === 0 ? "article" : "note",
}));

const seeded = (blocks: readonly NoteBlock[]): Y.Doc => {
  const doc = new Y.Doc();
  seedDoc(doc, blocks);
  return doc;
};

// the corpus as an editor holds it: a stored block its normalizer rewrites is seeded rewritten
const HELD = readBlocks(seeded(SECTIONED));

const columns = (...widths: readonly string[]): LibraryBlock => {
  const block = blockOfElement({
    children: widths.map((width) => ({
      children: [{ children: [{ text: width }], type: "p" }],
      type: "column",
      width,
    })),
    id: "columns",
    type: "column_group",
  });
  if (block === null) {
    throw new Error("a column group the store takes");
  }
  return block;
};

describe("a note's live document", () => {
  // the encoding alone, before any normalizer: every pair the library persists lands and reads back
  it("encodes every node, mark and prop the library persists, in order and section", () => {
    const used = new Set<string>();
    usedPairs(CORPUS, used);
    expect(schemaPairs().filter((pair) => !used.has(pair))).toStrictEqual([]);
    const doc = new Y.Doc();
    noteRoot(doc).applyDelta(
      slateNodesToInsertDelta(SECTIONED.map(({ block, section }) => sectioned(block, section))),
    );
    expect(readBlocks(doc)).toStrictEqual(SECTIONED);
  });

  it("reads back every block an editor holds as it was seeded, in order and section", () => {
    expect(HELD.length).toBeGreaterThan(CORPUS.length / 2);
    expect(readBlocks(seeded(HELD))).toStrictEqual(HELD);
  });

  it("seeds a block of every type with all the model lets it carry, and reads it back unchanged", () => {
    const listed = stored(withListProps([...FILES, ...GENERATED, ...UNSPELLED]), "listed").map(
      (block): NoteBlock => ({ block, section: "note" }),
    );
    expect(new Set(listed.map(({ block }) => block.type)).size).toBe(listed.length);
    expect(readBlocks(seeded(listed))).toStrictEqual(listed);
  });

  it("seeds a block an editor would rewrite as the editor holds it", () => {
    const held = readBlocks(
      seeded([
        { block: columns("40%", "60%"), section: "note" },
        { block: columns("100%"), section: "note" },
      ]),
    );
    expect(held.map(({ block }) => block.type)).toStrictEqual(["column_group", "p"]);
    expect(held[0]?.block).toStrictEqual(columns("40%", "60%"));
  });

  it("connects an editor that reads every block as it was seeded and writes nothing", () => {
    const doc = seeded(SECTIONED);
    const net = relay([doc]);
    const editor = liveEditor(doc);
    settle(net, [editor]);
    expect(net.sent(doc)).toBe(0);
    expect(editor.children.flatMap((element) => blockOfElement(element) ?? [])).toStrictEqual(
      readBlocks(doc).map(({ block }) => block),
    );
  });

  it("seeds a note with no blocks as one empty paragraph of the person's", () => {
    const [only, ...rest] = readBlocks(seeded([]));
    expect(rest).toStrictEqual([]);
    expect(only?.section).toBe("note");
    expect(only?.block).toMatchObject({ children: [{ text: "" }], type: "p" });
  });

  it("seeds only an empty document", () => {
    const doc = seeded([]);
    expect(() => {
      seedDoc(doc, SECTIONED);
    }).toThrow("seedDoc seeds an empty document");
  });

  it("reads a block around a picker open in it, and leaves out what no store takes", () => {
    const doc = seeded([
      { block: { children: [{ text: "before after" }], id: "typed", type: "p" }, section: "note" },
    ]);
    const net = relay([doc]);
    const editor = liveEditor(doc);
    editor.tf.insertNodes(
      { children: [{ text: "" }], trigger: "/", type: "slash_input" },
      { at: { offset: 7, path: [0, 0] } },
    );
    editor.tf.insertText("que", { at: [0, 1, 0], voids: true });
    editor.tf.insertNodes({ children: [{ text: "x" }], type: "not_a_block" }, { at: [1] });
    settle(net, [editor]);
    expect(editor.children[0]?.children).toHaveLength(3);
    expect(readBlocks(doc)).toStrictEqual([
      {
        block: { children: [{ text: "before after" }], id: "typed", type: "p" },
        section: "note",
      },
    ]);
  });
});
