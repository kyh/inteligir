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
import { editItemView } from "./item-edit";
import type { EditPorts } from "./item-edit";
import { importItem } from "./item-markdown";
import { itemView, viewPage } from "./item-view";

const OTHER_ID = "0195f3a0-5c1e-7000-8000-0000000000c1";

const titles = new Map([[OTHER_ID, "Other note"]]);

// an import whose links reach the items `titles` holds, by id or by title, and nothing else
const storedOf = (text: string): Map<string, StoredBlock> => {
  const ports = pretendLibrary().importPorts();
  const read = importItem(
    { name: "Item", text },
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
    newBlockId: () => {
      blocks += 1;
      return `n${String(blocks)}`;
    },
    title: (itemId) => titles.get(itemId) ?? null,
  };
};

const FIELDS: LibraryItemFields = {
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

// the item's blocks after the ops, as an applied write leaves them
const landed = (
  blocks: Map<string, StoredBlock>,
  ops: Parameters<typeof applyOps>[1],
): Map<string, StoredBlock> => {
  const state: ItemState = { blocks, fields: FIELDS };
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
  "Second paragraph here.",
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
    expect(view).toContain("Area is r ^2 and x==1==y and 50\\%% or 60%%");
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
    const [put] = outcome.ops;
    expect(put).toMatchObject({ block: { ref: "named" }, op: "put" });
    const written = JSON.stringify(put);
    expect(written).toContain('"source":"%%hidden%%"');
    expect(written).toContain("and ==stays== twice ");
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

describe("a footnote, its definition in another block", () => {
  it("reads as its text, the same in an edit of its call's line as in the whole item", () => {
    const blocks = storedOf("One[^a] word.\n\nTwo.\n\n[^a]: secret\n");
    const whole = JSON.stringify([...blocks.values()].map(({ block }) => withoutId(block)));
    expect(whole).not.toContain('"opaque"');
    const after = editedTo(blocks, "word.", "word!");
    expect(JSON.stringify([...after.values()].map(({ block }) => withoutId(block)))).toBe(
      whole.replace("word.", "word!"),
    );
    expect(textOf(after)).toBe("One\\[^a] word!\n\nTwo.\n\n\\[^a]: secret\n");
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

  describe("a person's two lines in a cell", () => {
    const LINES = "| a | b |\n| - | - |\n| one<br/>two | some words here |\n";
    const LINE_CELL = '"children":[{"text":"one"}],"type":"p"},{"children":[{"text":"two"}]';

    it("stay two lines through an edit of the next cell", () => {
      const blocks = storedOf(LINES);
      const after = cellsOf(editedTo(blocks, "words", "changed"));
      expect(after).toContain(LINE_CELL);
      expect(after).not.toContain('"source"');
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
