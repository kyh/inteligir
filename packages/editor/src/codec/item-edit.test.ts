import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { applyOps } from "@repo/notes/library/block-ops";
import type { ItemState, StoredBlock } from "@repo/notes/library/block-ops";
import { blockHash } from "@repo/notes/library/block-hash";
import { compareBlockPlaces } from "@repo/notes/library/block-order";
import type { LibraryItemFields } from "@repo/notes/library/library-item";
import { BLOCK_MAX_BYTES, LIST_MAX_INDENT } from "@repo/notes/library/library-nodes";
import type { LibraryBlock } from "@repo/notes/library/library-nodes";

import { pretendLibrary, withoutId } from "../test-support/codec-ports";
import { editItemView, placeItemQuotes } from "./item-edit";
import type { EditPorts } from "./item-edit";
import { importItem } from "./item-markdown";
import { itemView, viewPage } from "./item-view";

const OTHER_ID = "0195f3a0-5c1e-7000-8000-0000000000c1";

const titles = new Map([[OTHER_ID, "Other note"]]);

// an import whose links reach the items `titles` holds, by id or by title, and nothing else
const storedOf = (text: string): Map<string, StoredBlock> => {
  const ports = pretendLibrary().importPorts();
  const read = importItem(
    { annotations: null, name: "Item", text },
    {
      ...ports,
      wiki: (link) => {
        const byId = link.alias !== undefined && titles.has(link.alias) ? link.alias : null;
        const itemId = byId ?? [...titles].find(([, title]) => title === link.target)?.[0] ?? null;
        return itemId === null
          ? null
          : { itemId, kind: "item", title: titles.get(itemId) ?? link.target };
      },
    },
  );
  if (!read.ok) {
    throw new Error(read.reason);
  }
  return new Map(
    read.item.blocks.map((placed): [string, StoredBlock] => [
      placed.block.id,
      { ...placed, hash: blockHash(placed.block) },
    ]),
  );
};

const portsWith = (): EditPorts => {
  let blocks = 0;
  return {
    fileKind: () => "image",
    itemByTitle: (title) => [...titles].find(([, held]) => held === title)?.[0] ?? null,
    newAnnotationId: () => "new-highlight",
    newBlockId: () => {
      blocks += 1;
      return `n${String(blocks)}`;
    },
    title: (itemId) => titles.get(itemId) ?? null,
  };
};

// the item's blocks after the ops, as an applied write leaves them
const landed = (
  blocks: Map<string, StoredBlock>,
  ops: Parameters<typeof applyOps>[1],
): Map<string, StoredBlock> => {
  const fields: LibraryItemFields = {
    aliases: [],
    author: null,
    coverSha: null,
    deletedAt: null,
    description: null,
    fetchError: null,
    fetchState: "none",
    fetchedAt: null,
    folderId: null,
    kind: "note",
    lang: null,
    originalName: null,
    originalSha: null,
    pinnedAt: null,
    properties: {},
    published: null,
    savedAt: 0,
    site: null,
    tags: [],
    title: "Item",
    url: null,
  };
  const state: ItemState = { blocks, fields };
  const outcome = applyOps(state, ops);
  if (outcome.kind !== "applied") {
    throw new Error(`the ops did not land: ${outcome.kind}`);
  }
  return new Map(outcome.state.blocks);
};

const textOf = (blocks: Map<string, StoredBlock>): string => itemView(blocks, portsWith()).markdown;

// each block's ref and the text it stands on, in reading order
const textBlocks = (blocks: Map<string, StoredBlock>) =>
  itemView(blocks, portsWith()).blocks.map(({ block }) => ({
    ref: block.ref,
    text: block.children.map((child) => ("text" in child ? child.text : "")).join(""),
  }));

const NOTE = [
  "# Plan",
  "",
  `First paragraph links [[Other note|${OTHER_ID}]] and stays.`,
  "",
  "Second %%i:mark1:start%%highlighted words%%i:mark1:end%% here.",
  "",
  "- one",
  "- two",
  "- three",
  "",
  "Last line.",
  "",
].join("\n");

// the blocks after one edit of the view, which has to land
const editedTo = (
  blocks: Map<string, StoredBlock>,
  oldText: string,
  newText: string,
): Map<string, StoredBlock> => {
  const edited = editItemView(blocks, [{ newText, oldText }], portsWith());
  if (edited.kind !== "changed") {
    throw new Error(`the edit did not land: ${JSON.stringify(edited)}`);
  }
  return landed(blocks, edited.ops);
};

const groupOf = (label: string): string =>
  `:::tabs\n=== ${label}\nbody here now\n\n=== Second\nmore\n:::\n`;

// a table's row, read back: how many cells it holds, and what each one reads as
const cellsOf = (blocks: Map<string, StoredBlock>) => {
  const table = [...blocks.values()].find(({ block }) => block.type === "table");
  if (table === undefined || !("children" in table.block)) {
    throw new Error("no table landed");
  }
  return JSON.stringify(table.block.children.at(-1));
};

const withoutIds = (cells: string): string => cells.replaceAll(/"id":"[^"]*",?/gu, "");

describe("the agent's view of an item", () => {
  it("writes a link with its item's live title and id", () => {
    expect(textOf(storedOf(NOTE))).toContain(`[[Other note|${OTHER_ID}]]`);
  });

  it("turns down text no block can store, naming the edit, and leaves the block it would replace", () => {
    const fence = `\`\`\`inteligir-html\n${"x".repeat(BLOCK_MAX_BYTES)}\n\`\`\`\n`;
    expect(
      editItemView(
        storedOf("One.\n\nTwo.\n"),
        [
          { newText: "Still one.", oldText: "One." },
          { newText: fence, oldText: "Two." },
        ],
        portsWith(),
      ),
    ).toStrictEqual({ kind: "refused", refusal: { edit: 1, kind: "unstorable" } });
  });

  it("places every block where its group's text reads back as it", { timeout: 90_000 }, () => {
    const FIXTURES = fileURLToPath(new URL("../test-support/fixtures/roundtrip/", import.meta.url));
    for (const dir of ["canonical", "churn"]) {
      for (const file of readdirSync(`${FIXTURES}${dir}`)) {
        const blocks = storedOf(readFileSync(`${FIXTURES}${dir}/${file}`, "utf-8"));
        const view = itemView(blocks, portsWith());
        for (const placed of view.blocks) {
          expect(view.markdown.slice(placed.start, placed.end).trim(), `${dir}/${file}`).not.toBe(
            "",
          );
        }
        // an edit that writes every group back as it was changes nothing
        const whole = editItemView(
          blocks,
          [{ newText: view.markdown, oldText: view.markdown }],
          portsWith(),
        );
        expect(whole.kind === "changed" ? whole.ops : whole, `${dir}/${file}`).toStrictEqual([]);
      }
    }
  });

  it("pages by block range, a list kept whole", () => {
    const view = itemView(storedOf(NOTE), portsWith());
    const page = viewPage(view, 0, 2);
    expect(page).toMatchObject({ from: 0, to: 2, total: 7 });
    expect(page.markdown).toBe(
      `# Plan\n\nFirst paragraph links [[Other note|${OTHER_ID}]] and stays.\n`,
    );
    // starting inside the list takes the whole of it
    expect(viewPage(view, 4, 1)).toMatchObject({
      from: 3,
      markdown: "- one\n- two\n- three\n",
      to: 6,
    });
  });

  it("marks a page from the article as the article", () => {
    const text = [
      "---",
      "kind: link",
      "url: https://example.com/x",
      "---",
      "",
      "My note.",
      "",
      ":::article",
      "The page.",
      ":::",
      "",
    ].join("\n");
    const view = itemView(storedOf(text), portsWith());
    expect(view.markdown).toBe("My note.\n\n:::article\n\nThe page.\n\n:::\n");
    expect(viewPage(view, 1, 1).markdown).toBe(":::article\n\nThe page.\n\n:::\n");
  });
});

describe("an edit made on the view", () => {
  it("puts the one block it changed and leaves every other id and block alone", () => {
    const blocks = storedOf(NOTE);
    const outcome = editItemView(
      blocks,
      [{ newText: "Last line, edited.", oldText: "Last line." }],
      portsWith(),
    );
    expect(outcome).toMatchObject({ dropped: [], kind: "changed" });
    if (outcome.kind !== "changed") {
      return;
    }
    const last = [...blocks.values()].find((stored) =>
      JSON.stringify(stored.block).includes("Last line"),
    );
    expect(outcome.ops).toStrictEqual([
      expect.objectContaining({ baseHash: last?.hash, op: "put" }),
    ]);
    const after = landed(blocks, outcome.ops);
    expect([...after.keys()]).toStrictEqual([...blocks.keys()]);
    expect(textOf(after)).toContain("Last line, edited.");
  });

  it("inserts a new block between its neighbours, ordered between their keys", () => {
    const blocks = storedOf(NOTE);
    const outcome = editItemView(
      blocks,
      [{ newText: "and stays.\n\nA new paragraph.", oldText: "and stays." }],
      portsWith(),
    );
    if (outcome.kind !== "changed") {
      throw new Error(outcome.refusal.kind);
    }
    expect(outcome.ops.map((op) => op.op)).toStrictEqual(["insert"]);
    const after = landed(blocks, outcome.ops);
    const order = [...after.values()]
      .toSorted((a, b) =>
        compareBlockPlaces(
          { blockId: a.block.id, ord: a.ord, section: a.section },
          { blockId: b.block.id, ord: b.ord, section: b.section },
        ),
      )
      .map((stored) => JSON.stringify(stored.block.children).slice(0, 30));
    expect(order[2]).toContain("A new paragraph.");
    expect(textOf(after)).toContain("and stays.\n\nA new paragraph.\n\nSecond");
  });

  it("lands a new block between two blocks that hold one key, moving one of them", () => {
    const blocks = storedOf("Before.\n\nAlpha.\n\nBeta.\n\nAfter.\n");
    const [, alpha, beta] = [...blocks.values()];
    if (alpha === undefined || beta === undefined) {
      throw new Error("the item holds fewer blocks than it was written with");
    }
    // two devices that added after one block mint one key
    blocks.set(beta.block.id, { ...beta, ord: alpha.ord });
    const outcome = editItemView(
      blocks,
      [{ newText: "Alpha.\n\nBetween.", oldText: "Alpha." }],
      portsWith(),
    );
    if (outcome.kind !== "changed") {
      throw new Error(`the edit was refused: ${JSON.stringify(outcome)}`);
    }
    expect(outcome.ops.filter((op) => op.op === "move")).toHaveLength(1);
    expect(textOf(landed(blocks, outcome.ops))).toBe(
      "Before.\n\nAlpha.\n\nBetween.\n\nBeta.\n\nAfter.\n",
    );
  });

  it("moves no block an edit that adds none had no need of", () => {
    const blocks = storedOf("Alpha.\n\nBeta.\n\nAfter.\n");
    const [alpha, beta] = [...blocks.values()];
    if (alpha === undefined || beta === undefined) {
      throw new Error("the item holds fewer blocks than it was written with");
    }
    blocks.set(beta.block.id, { ...beta, ord: alpha.ord });
    const outcome = editItemView(blocks, [{ newText: "Later.", oldText: "After." }], portsWith());
    expect(outcome.kind === "changed" ? outcome.ops.map((op) => op.op) : outcome).toStrictEqual([
      "put",
    ]);
  });

  it("drops a block it deleted", () => {
    const blocks = storedOf(NOTE);
    const outcome = editItemView(blocks, [{ newText: "", oldText: "\n\nLast line." }], portsWith());
    expect(outcome.kind === "changed" ? outcome.ops.map((op) => op.op) : outcome).toStrictEqual([
      "drop",
    ]);
  });

  it("reads a list again whole, and puts only the item it changed", () => {
    const blocks = storedOf(NOTE);
    const outcome = editItemView(blocks, [{ newText: "- TWO", oldText: "- two" }], portsWith());
    if (outcome.kind !== "changed") {
      throw new Error(outcome.refusal.kind);
    }
    expect(outcome.ops).toHaveLength(1);
    expect(JSON.stringify(outcome.ops[0])).toContain("TWO");
  });

  it("keeps a highlight's markers through an edit beside them, and names one it took out", () => {
    const blocks = storedOf(NOTE);
    const kept = editItemView(blocks, [{ newText: "Second, ", oldText: "Second " }], portsWith());
    expect(kept).toMatchObject({ dropped: [], kind: "changed" });
    const lost = editItemView(
      blocks,
      [
        {
          newText: "Second plain words here.",
          oldText: "Second %%i:mark1:start%%highlighted words%%i:mark1:end%% here.",
        },
      ],
      portsWith(),
    );
    expect(lost).toMatchObject({ dropped: ["mark1"], kind: "changed" });
  });

  it("names a highlight it took one edge of, and none whose edge it only moved", () => {
    const blocks = storedOf(NOTE);
    for (const edge of ["start", "end"]) {
      const half = editItemView(
        blocks,
        [{ newText: "", oldText: `%%i:mark1:${edge}%%` }],
        portsWith(),
      );
      expect(half, edge).toMatchObject({ dropped: ["mark1"], kind: "changed" });
    }
    const moved = editItemView(
      blocks,
      [
        { newText: "highlighted", oldText: "highlighted words%%i:mark1:end%%" },
        { newText: "Last line.%%i:mark1:end%%", oldText: "Last line." },
      ],
      portsWith(),
    );
    expect(moved).toMatchObject({ dropped: [], kind: "changed" });
  });

  it("refuses new text that nests deeper than the editor reads, losing no block", () => {
    const blocks = storedOf(NOTE);
    // past the conversion's reach, and past the parse's own
    for (const depth of [1500, 12_000]) {
      expect(
        editItemView(
          blocks,
          [{ newText: `${"> ".repeat(depth)}x`, oldText: "Last line." }],
          portsWith(),
        ),
        String(depth),
      ).toStrictEqual({ kind: "refused", refusal: { edit: 0, kind: "too-deep" } });
    }
  });

  it("refuses a list nested past what the writer holds, in a few bytes as in many", () => {
    expect(
      editItemView(
        storedOf(NOTE),
        [{ newText: `${"- ".repeat(LIST_MAX_INDENT + 1)}x`, oldText: "Last line." }],
        portsWith(),
      ),
    ).toStrictEqual({ kind: "refused", refusal: { edit: 0, kind: "too-deep" } });
  });

  it("keeps the item a link it did not change names, and finds one written by title", () => {
    const blocks = storedOf(NOTE);
    const outcome = editItemView(
      blocks,
      [{ newText: "and also [[Other note]] here.", oldText: "and stays." }],
      portsWith(),
    );
    if (outcome.kind !== "changed") {
      throw new Error(outcome.refusal.kind);
    }
    const links = JSON.stringify(outcome.ops).match(new RegExp(OTHER_ID, "gu")) ?? [];
    expect(links).toHaveLength(2);
  });

  it("keeps typed text that looks like Obsidian's through an edit of its block", () => {
    const blocks = storedOf(
      "Area is r \\^2 and x\\==1==y and 50\\%% or 60%%\n\nEnds on r \\^2\n\n\\^alone\n",
    );
    const view = textOf(blocks);
    expect(view).toContain("Area is r ^2 and x\\==1==y and 50\\%% or 60%%");
    expect(view).toContain("Ends on r \\^2");
    expect(view).toContain("\\^alone");
    const outcome = editItemView(
      blocks,
      [
        { newText: "The area", oldText: "Area" },
        { newText: "Ending", oldText: "Ends" },
        { newText: "\\^kept", oldText: "\\^alone" },
      ],
      portsWith(),
    );
    if (outcome.kind !== "changed") {
      throw new Error(outcome.refusal.kind);
    }
    expect(outcome.highlights).toStrictEqual([]);
    expect(textBlocks(landed(blocks, outcome.ops))).toStrictEqual([
      { ref: undefined, text: "The area is r ^2 and x==1==y and 50%% or 60%%" },
      { ref: undefined, text: "Ending on r ^2" },
      { ref: undefined, text: "^kept" },
    ]);
  });

  it("keeps an escape an edit writes on a line beside a `:::` line as the person's text", () => {
    const blocks = storedOf(":::toggle\nbody here\n:::\n");
    const outcome = editItemView(
      blocks,
      [{ newText: "first line\n\\==x== literal", oldText: "body here" }],
      portsWith(),
    );
    if (outcome.kind !== "changed") {
      throw new Error(outcome.refusal.kind);
    }
    expect(outcome.highlights).toStrictEqual([]);
    expect(JSON.stringify(outcome.ops)).toContain("==x== literal");
  });

  it("lands a web image an edit writes in a list as the embed it is", () => {
    const blocks = storedOf("One.\n\nTwo.\n");
    const outcome = editItemView(
      blocks,
      [{ newText: "- ![](https://a.b/c.png)", oldText: "Two." }],
      portsWith(),
    );
    if (outcome.kind !== "changed") {
      throw new Error(outcome.refusal.kind);
    }
    expect(JSON.stringify(outcome.ops)).toContain('"url":"https://a.b/c.png"');
  });

  it("reads the spellings an edit writes in the note, the last edit's alone", () => {
    const blocks = storedOf(NOTE);
    const outcome = editItemView(
      blocks,
      [
        { newText: "and ==stays== once.", oldText: "and stays." },
        {
          newText: "and ==stays== twice %%hidden%% here. ^named",
          oldText: "and ==stays== once.",
        },
      ],
      portsWith(),
    );
    if (outcome.kind !== "changed") {
      throw new Error(outcome.refusal.kind);
    }
    expect(outcome.highlights).toStrictEqual([{ id: "new-highlight", quote: "stays" }]);
    const [put] = outcome.ops;
    expect(put).toMatchObject({ block: { ref: "named" }, op: "put" });
    const written = JSON.stringify(put);
    expect(written).toContain('"source":"%%hidden%%"');
    expect(written).toContain('"type":"annotationMarker"');
    expect(written).not.toContain("==");
  });

  it("reads no spelling an edit writes in a page", () => {
    const blocks = storedOf(`Note.\n\n:::article\n\nThe page says.\n\n:::\n`);
    const outcome = editItemView(
      blocks,
      [{ newText: "The ==page== %%says%% so. ^x", oldText: "The page says." }],
      portsWith(),
    );
    if (outcome.kind !== "changed") {
      throw new Error(outcome.refusal.kind);
    }
    expect(outcome.highlights).toStrictEqual([]);
    expect(textBlocks(landed(blocks, outcome.ops)).at(-1)).toStrictEqual({
      ref: undefined,
      text: "The ==page== %%says%% so. ^x",
    });
  });

  it("refuses an old text it cannot place once", () => {
    const blocks = storedOf(NOTE);
    expect(editItemView(blocks, [{ newText: "x", oldText: "" }], portsWith())).toStrictEqual({
      kind: "refused",
      refusal: { edit: 0, kind: "empty" },
    });
    expect(editItemView(blocks, [{ newText: "x", oldText: "absent" }], portsWith())).toMatchObject({
      refusal: { kind: "missing" },
    });
    expect(editItemView(blocks, [{ newText: "x", oldText: "- t" }], portsWith())).toMatchObject({
      refusal: { count: 2, kind: "ambiguous" },
    });
  });

  it("reads an edit that starts between two blocks over both of them", () => {
    const blocks = storedOf(NOTE);
    const outcome = editItemView(
      blocks,
      [{ newText: "\nLast line, edited.", oldText: "\nLast line." }],
      portsWith(),
    );
    if (outcome.kind !== "changed") {
      throw new Error(outcome.refusal.kind);
    }
    expect(outcome.ops.map((op) => op.op)).toStrictEqual(["put"]);
    expect(textOf(landed(blocks, outcome.ops))).toBe(
      textOf(blocks).replace("Last line.", "Last line, edited."),
    );
  });

  const PAGE_ONLY = [
    "---",
    "kind: link",
    "url: https://example.com/x",
    "---",
    "",
    ":::article",
    "Page.",
    ":::",
    "",
  ].join("\n");

  const WITH_NOTE = PAGE_ONLY.replace(":::article", "Note.\n\n:::article");

  it("writes a note above a page the item holds alone", () => {
    const blocks = storedOf(PAGE_ONLY);
    const outcome = editItemView(
      blocks,
      [{ newText: "My summary.\n\n:::article", oldText: ":::article" }],
      portsWith(),
    );
    if (outcome.kind !== "changed") {
      throw new Error(outcome.refusal.kind);
    }
    expect(outcome.ops).toStrictEqual([expect.objectContaining({ op: "insert", section: "note" })]);
    expect(textOf(landed(blocks, outcome.ops))).toBe("My summary.\n\n:::article\n\nPage.\n\n:::\n");
  });

  it("reads an edit across the article's line in each section it reaches", () => {
    const blocks = storedOf(WITH_NOTE);
    const outcome = editItemView(
      blocks,
      [
        {
          newText: "Note, edited.\n\n:::article\n\nPage, edited.",
          oldText: "Note.\n\n:::article\n\nPage.",
        },
      ],
      portsWith(),
    );
    if (outcome.kind !== "changed") {
      throw new Error(outcome.refusal.kind);
    }
    expect(outcome.ops.map((op) => op.op)).toStrictEqual(["put", "put"]);
    expect(textOf(landed(blocks, outcome.ops))).toBe(
      "Note, edited.\n\n:::article\n\nPage, edited.\n\n:::\n",
    );
  });

  it("refuses an edit that changes the article section's own lines", () => {
    const blocks = storedOf(WITH_NOTE);
    expect(
      editItemView(
        blocks,
        [{ newText: "Note. Page.", oldText: "Note.\n\n:::article\n\nPage." }],
        portsWith(),
      ),
    ).toMatchObject({ refusal: { kind: "section" } });
    expect(
      editItemView(
        blocks,
        [{ newText: "Page.\n\n:::\n\nAfter it.", oldText: "Page.\n\n:::" }],
        portsWith(),
      ),
    ).toMatchObject({ refusal: { kind: "section" } });
  });

  it("applies each edit to the text the ones before it left", () => {
    const blocks = storedOf(NOTE);
    const outcome = editItemView(
      blocks,
      [
        { newText: "Last words.", oldText: "Last line." },
        { newText: "Final words.", oldText: "Last words." },
      ],
      portsWith(),
    );
    if (outcome.kind !== "changed") {
      throw new Error(outcome.refusal.kind);
    }
    expect(textOf(landed(blocks, outcome.ops))).toContain("Final words.");
  });
});

describe("a footnote's call, its definition in another block", () => {
  const FOOTNOTED = "One[^a] word and more.\n\nTwo.\n\n[^a]: secret\n";

  it("stays a call through an edit of its line", () => {
    const blocks = storedOf(FOOTNOTED);
    const after = editedTo(blocks, "word", "sentence");
    expect(JSON.stringify([...after.values()].map(({ block }) => block))).toContain(
      '{"children":[{"text":""}],"source":"[^a]","type":"opaque"}',
    );
    expect(textOf(after)).toBe("One[^a] sentence and more.\n\nTwo.\n\n[^a]: secret\n");
  });

  it.each([
    ["word and", "One[^a] %%i:q1:start%%word and%%i:q1:end%% more."],
    ["One word", "%%i:q1:start%%One[^a] word%%i:q1:end%% and more."],
  ])("stays a call through the quote `%s` placed on its line", (quote, line) => {
    for (const text of [FOOTNOTED, "One[^a] word and more.\n\nTwo.\n"]) {
      const blocks = storedOf(text);
      const placed = placeItemQuotes(blocks, [{ id: "q1", quote }], portsWith());
      expect(placed).toMatchObject({ missing: [], placed: ["q1"] });
      expect(textOf(landed(blocks, placed.ops))).toContain(line);
    }
  });

  it("reads the same in an edit of its line as in the whole item", () => {
    const blocks = storedOf("One[^a] word.\n\nTwo.\n");
    const whole = JSON.stringify([...blocks.values()].map(({ block }) => withoutId(block)));
    const after = editedTo(blocks, "word.", "word!");
    expect(JSON.stringify([...after.values()].map(({ block }) => withoutId(block)))).toBe(
      whole.replace("word.", "word!"),
    );
  });

  it.each([
    [String.raw`One \[^a] word.`],
    [String.raw`One [\^a] word.`],
    [String.raw`One [^a\] word.`],
    ["One `[^a]` word."],
  ])("leaves what a person typed, `%s`, as text through an edit", (line) => {
    const blocks = storedOf(`${line}\n\nTwo.\n`);
    expect(JSON.stringify([...blocks.values()])).not.toContain('"opaque"');
    const after = editedTo(blocks, "word", "sentence");
    expect(JSON.stringify([...after.values()])).not.toContain('"opaque"');
    expect(textOf(after)).toContain("sentence.");
  });
});

describe("a bare link whose address spells a call", () => {
  const ADDRESS = "https://x.y/?q=[^a-z]+b";
  const paragraph: LibraryBlock = {
    children: [
      { text: "see " },
      { children: [{ text: ADDRESS }], type: "a", url: ADDRESS },
      { text: " now and then" },
    ],
    id: "p",
    type: "p",
  };
  const stored = (): Map<string, StoredBlock> =>
    new Map([["p", { block: paragraph, hash: blockHash(paragraph), ord: "a0", section: "note" }]]);
  const linkIn = (blocks: Map<string, StoredBlock>): unknown => {
    const block = blocks.values().next().value?.block;
    return block !== undefined && "children" in block ? block.children[1] : null;
  };
  const untouched = { children: [{ text: ADDRESS }], type: "a", url: ADDRESS };

  it("stands untouched through an edit elsewhere in its paragraph", () => {
    const after = editedTo(stored(), "then", "later");
    expect(linkIn(after)).toStrictEqual(untouched);
    expect(textOf(after)).toBe(`see ${ADDRESS} now and later\n`);
  });

  it("stands untouched through a quote placed elsewhere in its paragraph", () => {
    const blocks = stored();
    const placed = placeItemQuotes(blocks, [{ id: "q1", quote: "then" }], portsWith());
    expect(placed).toMatchObject({ missing: [], placed: ["q1"] });
    const after = landed(blocks, placed.ops);
    expect(linkIn(after)).toStrictEqual(untouched);
    expect(textOf(after)).toBe(`see ${ADDRESS} now and %%i:q1:start%%then%%i:q1:end%%\n`);
  });

  it("places a quote of its own text", () => {
    const placed = placeItemQuotes(stored(), [{ id: "q1", quote: ADDRESS }], portsWith());
    expect(placed).toMatchObject({ missing: [], placed: ["q1"] });
  });
});

describe("a link or an equation in a table cell", () => {
  it.each([
    ["a link", "| a | b |\n| - | - |\n| [[Other note]] | word |\n"],
    [
      "an aliased link",
      String.raw`| a | b |
| - | - |
| [[Other note\|shown]] | word |
`,
    ],
    [
      "an embed",
      String.raw`| a | b |
| - | - |
| ![[Other note\|300]] | word |
`,
    ],
  ])("keeps %s and its row through an edit of the next cell", (_label, table) => {
    const blocks = storedOf(table);
    const before = cellsOf(blocks);
    expect(before).toContain(OTHER_ID);
    expect(withoutIds(cellsOf(editedTo(blocks, "word", "changed")))).toBe(
      withoutIds(before).replace("word", "changed"),
    );
  });

  it("keeps the row through a quote placed in the next cell", () => {
    const blocks = storedOf("| a | b |\n| - | - |\n| [[Other note]] | some words here |\n");
    const placed = placeItemQuotes(blocks, [{ id: "q1", quote: "words" }], portsWith());
    expect(placed).toMatchObject({ missing: [], placed: ["q1"] });
    const row = cellsOf(landed(blocks, placed.ops));
    expect(row).toContain(OTHER_ID);
    expect(row.match(/"type":"td"/gu)).toHaveLength(2);
  });

  describe("a person's two lines in a cell", () => {
    const LINES = "| a | b |\n| - | - |\n| one<br/>two | some words here |\n";
    const LINE_CELL = '"children":[{"text":"one"}],"type":"p"},{"children":[{"text":"two"}]';

    it("stay two lines through an edit of the next cell", () => {
      const blocks = storedOf(LINES);
      const after = cellsOf(editedTo(blocks, "words", "changed"));
      expect(after).toContain(LINE_CELL);
      expect(after).not.toContain('"source"');
    });

    it("stay two lines through a quote placed in the next cell", () => {
      const blocks = storedOf(LINES);
      const placed = placeItemQuotes(blocks, [{ id: "q1", quote: "words" }], portsWith());
      expect(placed).toMatchObject({ missing: [], placed: ["q1"] });
      expect(cellsOf(landed(blocks, placed.ops))).toContain(LINE_CELL);
    });
  });

  it("keeps the row of a code span a person typed its own backslash and pipe in", () => {
    const table: LibraryBlock = {
      children: [
        {
          children: [
            {
              children: [{ children: [{ code: true, text: String.raw`a\|b` }], type: "p" }],
              type: "td",
            },
            { children: [{ children: [{ text: "word" }], type: "p" }], type: "td" },
          ],
          type: "tr",
        },
      ],
      id: "t",
      type: "table",
    };
    const blocks = new Map<string, StoredBlock>([
      ["t", { block: table, hash: blockHash(table), ord: "a0", section: "note" }],
    ]);
    const row = cellsOf(editedTo(blocks, "word", "changed"));
    expect(row.match(/"type":"t[dh]"/gu)).toHaveLength(2);
    expect(row).toContain('"code":true');
    expect(row).toContain('"text":"changed"');
  });

  it("finds a quote by the pipes an equation in a cell shows", () => {
    const blocks = storedOf(String.raw`| a |
| - |
| $$\|x\|$$ and words |
`);
    const placed = placeItemQuotes(blocks, [{ id: "q1", quote: "|x| and" }], portsWith());
    expect(placed).toMatchObject({ missing: [], placed: ["q1"] });
  });

  it("keeps an equation's pipes in its cell through an edit of the next cell", () => {
    const blocks = storedOf(String.raw`| a | b |
| - | - |
| $$\|x\| + \Vert y$$ | word |
`);
    const before = cellsOf(blocks);
    expect(before).toContain(String.raw`|x| + \\Vert y`);
    expect(withoutIds(cellsOf(editedTo(blocks, "word", "changed")))).toBe(
      withoutIds(before).replace("word", "changed"),
    );
  });
});

describe("a highlight placed by its quote", () => {
  it("lands its markers in the page first, putting only the block it wraps", () => {
    const text = [
      "---",
      "kind: link",
      "url: https://example.com/x",
      "---",
      "",
      "My note says shared words too.",
      "",
      ":::article",
      "The page has shared words in it.",
      "",
      "Another page paragraph.",
      ":::",
      "",
    ].join("\n");
    const blocks = storedOf(text);
    const placed = placeItemQuotes(blocks, [{ id: "q1", quote: "shared words" }], portsWith());
    expect(placed).toMatchObject({ missing: [], placed: ["q1"] });
    expect(placed.ops).toHaveLength(1);
    const after = landed(blocks, placed.ops);
    expect(textOf(after)).toContain("The page has %%i:q1:start%%shared words%%i:q1:end%% in it.");
    expect([...after.values()].map((stored) => withoutId(stored.block))).toHaveLength(3);
  });

  it("finds no quote in a footnote's definition, whose source holds no marker", () => {
    const blocks = storedOf("One[^a].\n\nTwo.\n\n[^a]: the source words\n\n    and more body\n");
    const placed = placeItemQuotes(
      blocks,
      [
        { id: "q1", quote: "source words" },
        { id: "q2", quote: "more body" },
      ],
      portsWith(),
    );
    expect(placed).toMatchObject({ missing: ["q1", "q2"], ops: [], placed: [] });
  });

  it("leaves a quote whose markers the note holds where it stands", () => {
    const text = [
      "---",
      "kind: link",
      "url: https://example.com/x",
      "---",
      "",
      "My note says %%i:q1:start%%shared words%%i:q1:end%% too.",
      "",
      ":::article",
      "The page has shared words in it.",
      ":::",
      "",
    ].join("\n");
    const blocks = storedOf(text);
    const placed = placeItemQuotes(
      blocks,
      [
        { id: "q1", quote: "shared words" },
        { id: "q2", quote: "page has" },
      ],
      portsWith(),
    );
    expect(placed).toMatchObject({ missing: [], placed: ["q1", "q2"] });
    const after = textOf(landed(blocks, placed.ops));
    expect(after).toContain("The %%i:q2:start%%page has%%i:q2:end%% shared words in it.");
    expect(after.match(/%%i:q1:start%%/gu)).toHaveLength(1);
  });

  describe("a tab's label holding an address", () => {
    it.each([
      [String.raw`https\://x.cd docs`, "docs"],
      [String.raw`https\://x.cd`, "https://x.cd"],
      [String.raw`https\://x.cd`, "https://x.cd body"],
      [String.raw`www\.x.cd site`, "site"],
      [String.raw`a\@b.cd team`, "team"],
    ])("finds no quote in `%s`, and leaves the group be", (label, quote) => {
      const blocks = storedOf(groupOf(label));
      expect(placeItemQuotes(blocks, [{ id: "q1", quote }], portsWith())).toMatchObject({
        missing: ["q1"],
        ops: [],
        placed: [],
      });
    });

    it("places a quote the label also spells in the body beneath it", () => {
      const label = String.raw`see https\://a.bc/d now`;
      const blocks = storedOf(groupOf(label));
      const placed = placeItemQuotes(blocks, [{ id: "q1", quote: "now" }], portsWith());
      expect(placed).toMatchObject({ missing: [], placed: ["q1"] });
      const after = landed(blocks, placed.ops);
      expect([...after.values()].map(({ block }) => block.type)).toStrictEqual(["tab_group"]);
      expect(textOf(after)).toBe(
        `:::tabs\n=== ${label}\nbody here %%i:q1:start%%now%%i:q1:end%%\n\n=== Second\nmore\n:::\n`,
      );
    });
  });

  it("names a quote no passage matches", () => {
    const placed = placeItemQuotes(
      storedOf(NOTE),
      [{ id: "q2", quote: "nowhere to be read" }],
      portsWith(),
    );
    expect(placed).toMatchObject({ missing: ["q2"], ops: [], placed: [] });
  });
});
