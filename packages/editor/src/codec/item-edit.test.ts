import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { BodyBlock } from "@repo/contract/library/derive-item";
import { BLOCK_MAX_BYTES, LIST_MAX_INDENT } from "@repo/contract/library/library-nodes";
import type { LibraryBlock } from "@repo/contract/library/library-nodes";

import { pretendLibrary, withoutId } from "../test-support/codec-ports";
import { editItemView } from "./item-edit";
import type { EditPorts } from "./item-edit";
import { importItem } from "./item-markdown";
import { libraryLinks } from "./library-links";
import { itemView, viewPage } from "./item-view";
import type { BodyChange } from "../live/body-change";

const OTHER_ID = "0195f3a0-5c1e-7000-8000-0000000000c1";

const titles = new Map([[OTHER_ID, "Other note"]]);

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

// an import whose links reach the items `titles` holds, by title, and nothing else
const storedOf = (text: string): BodyBlock[] => {
  const read = importItem(
    { name: "Item", text },
    { ...pretendLibrary().importPorts(), ...libraryLinks(portsWith()) },
  );
  if (!read.ok) {
    throw new Error(read.reason);
  }
  return [...read.item.blocks];
};

const placeAfter = (blocks: BodyBlock[], afterId: string | null, body: BodyBlock): void => {
  blocks.splice(
    afterId === null ? 0 : blocks.findIndex(({ block }) => block.id === afterId) + 1,
    0,
    body,
  );
};

// the item's blocks after the changes, as its note lands them on a body nobody else touched
const landed = (blocks: readonly BodyBlock[], changes: readonly BodyChange[]): BodyBlock[] => {
  const after = [...blocks];
  const at = (id: string): number => after.findIndex(({ block }) => block.id === id);
  for (const change of changes) {
    switch (change.kind) {
      case "put": {
        const index = at(change.blockId);
        const held = after[index];
        if (held !== undefined) {
          after[index] = { ...held, block: change.block };
        }
        break;
      }
      case "drop": {
        after.splice(at(change.blockId), 1);
        break;
      }
      case "insertAfter": {
        placeAfter(after, change.afterId, { block: change.block, section: change.section });
        break;
      }
      case "move": {
        const [held] = after.splice(at(change.blockId), 1);
        if (held !== undefined) {
          placeAfter(after, change.afterId, held);
        }
        break;
      }
      // no default
    }
  }
  return after;
};

const textOf = (blocks: readonly BodyBlock[]): string => itemView(blocks, portsWith()).markdown;

// each block's text, in reading order
const textBlocks = (blocks: readonly BodyBlock[]): string[] =>
  itemView(blocks, portsWith()).blocks.map(({ block }) =>
    block.children.map((child) => ("text" in child ? child.text : "")).join(""),
  );

const NOTE = [
  "# Plan",
  "",
  "First paragraph links [[Other note]] and stays.",
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
const editedTo = (blocks: readonly BodyBlock[], oldText: string, newText: string): BodyBlock[] => {
  const edited = editItemView(blocks, [{ newText, oldText }], portsWith());
  if (edited.kind !== "changed") {
    throw new Error(`the edit did not land: ${JSON.stringify(edited)}`);
  }
  return landed(blocks, edited.changes);
};

// a table's row, read back: how many cells it holds, and what each one reads as
const cellsOf = (blocks: readonly BodyBlock[]) => {
  const table = blocks.find(({ block }) => block.type === "table");
  if (table === undefined || !("children" in table.block)) {
    throw new Error("no table landed");
  }
  return JSON.stringify(table.block.children.at(-1));
};

const withoutIds = (cells: string): string => cells.replaceAll(/"id":"[^"]*",?/gu, "");

describe("the agent's view of an item", () => {
  it("writes a link with its item's live title and id", () => {
    expect(textOf(storedOf(NOTE))).toContain(`[Other note](mention:${OTHER_ID})`);
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
    const FIXTURES = fileURLToPath(new URL("../test-support/fixtures/corpus/", import.meta.url));
    for (const file of readdirSync(FIXTURES)) {
      const blocks = storedOf(readFileSync(`${FIXTURES}${file}`, "utf-8"));
      const view = itemView(blocks, portsWith());
      for (const placed of view.blocks) {
        expect(view.markdown.slice(placed.start, placed.end).trim(), file).not.toBe("");
      }
      // an edit that writes every group back as it was changes nothing
      const whole = editItemView(
        blocks,
        [{ newText: view.markdown, oldText: view.markdown }],
        portsWith(),
      );
      expect(whole.kind === "changed" ? whole.changes : whole, file).toStrictEqual([]);
    }
  });

  it("pages by block range, a list kept whole", () => {
    const view = itemView(storedOf(NOTE), portsWith());
    const page = viewPage(view, 0, 2);
    expect(page).toMatchObject({ from: 0, to: 2, total: 7 });
    expect(page.markdown).toBe(
      `# Plan\n\nFirst paragraph links [Other note](mention:${OTHER_ID}) and stays.\n`,
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
    const last = blocks.find((stored) => JSON.stringify(stored.block).includes("Last line"));
    expect(outcome.changes).toStrictEqual([
      expect.objectContaining({ base: last?.block, kind: "put" }),
    ]);
    const after = landed(blocks, outcome.changes);
    expect(after.map(({ block }) => block.id)).toStrictEqual(blocks.map(({ block }) => block.id));
    expect(textOf(after)).toContain("Last line, edited.");
  });

  it("inserts a new block after the one it follows", () => {
    const blocks = storedOf(NOTE);
    const outcome = editItemView(
      blocks,
      [{ newText: "and stays.\n\nA new paragraph.", oldText: "and stays." }],
      portsWith(),
    );
    if (outcome.kind !== "changed") {
      throw new Error(outcome.refusal.kind);
    }
    expect(outcome.changes).toStrictEqual([
      expect.objectContaining({ afterId: blocks[1]?.block.id, kind: "insertAfter" }),
    ]);
    const after = landed(blocks, outcome.changes);
    const order = after.map((stored) => JSON.stringify(stored.block.children).slice(0, 30));
    expect(order[2]).toContain("A new paragraph.");
    expect(textOf(after)).toContain("and stays.\n\nA new paragraph.\n\nSecond");
  });

  it("drops a block it deleted", () => {
    const blocks = storedOf(NOTE);
    const outcome = editItemView(blocks, [{ newText: "", oldText: "\n\nLast line." }], portsWith());
    expect(
      outcome.kind === "changed" ? outcome.changes.map((change) => change.kind) : outcome,
    ).toStrictEqual(["drop"]);
  });

  it("reads a list again whole, and puts only the item it changed", () => {
    const blocks = storedOf(NOTE);
    const outcome = editItemView(blocks, [{ newText: "- TWO", oldText: "- two" }], portsWith());
    if (outcome.kind !== "changed") {
      throw new Error(outcome.refusal.kind);
    }
    expect(outcome.changes).toHaveLength(1);
    expect(JSON.stringify(outcome.changes[0])).toContain("TWO");
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
    const written = outcome.changes.map((change) => ("block" in change ? change.block : null));
    const links = JSON.stringify(written).match(new RegExp(OTHER_ID, "gu")) ?? [];
    expect(links).toHaveLength(2);
  });

  it("keeps Obsidian's `^ref`, `%%` and `==` the text they are through an edit of their block", () => {
    const blocks = storedOf(
      "Area is r ^2 and x==1==y and 50%% or 60%%\n\nEnds on r ^2\n\n^alone\n",
    );
    const outcome = editItemView(
      blocks,
      [
        { newText: "The area", oldText: "Area" },
        { newText: "Ending", oldText: "Ends" },
        { newText: "^kept", oldText: "^alone" },
      ],
      portsWith(),
    );
    if (outcome.kind !== "changed") {
      throw new Error(outcome.refusal.kind);
    }
    expect(textBlocks(landed(blocks, outcome.changes))).toStrictEqual([
      "The area is r ^2 and x==1==y and 50%% or 60%%",
      "Ending on r ^2",
      "^kept",
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
    expect(JSON.stringify(outcome.changes)).toContain("==x== literal");
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
    expect(JSON.stringify(outcome.changes)).toContain('"url":"https://a.b/c.png"');
  });

  it("keeps the spellings an edit writes the text they are, the last edit's alone", () => {
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
    expect(outcome.changes).toHaveLength(1);
    expect(JSON.stringify(outcome.changes[0])).toContain(
      '"text":" and ==stays== twice %%hidden%% here. ^named"',
    );
  });

  it("keeps the spellings an edit writes in a page the text they are", () => {
    const blocks = storedOf(`Note.\n\n:::article\n\nThe page says.\n\n:::\n`);
    const outcome = editItemView(
      blocks,
      [{ newText: "The ==page== %%says%% so. ^x", oldText: "The page says." }],
      portsWith(),
    );
    if (outcome.kind !== "changed") {
      throw new Error(outcome.refusal.kind);
    }
    expect(textBlocks(landed(blocks, outcome.changes)).at(-1)).toBe("The ==page== %%says%% so. ^x");
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
    expect(outcome.changes.map((change) => change.kind)).toStrictEqual(["put"]);
    expect(textOf(landed(blocks, outcome.changes))).toBe(
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
    expect(outcome.changes).toStrictEqual([
      expect.objectContaining({ kind: "insertAfter", section: "note" }),
    ]);
    expect(textOf(landed(blocks, outcome.changes))).toBe(
      "My summary.\n\n:::article\n\nPage.\n\n:::\n",
    );
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
    expect(outcome.changes.map((change) => change.kind)).toStrictEqual(["put", "put"]);
    expect(textOf(landed(blocks, outcome.changes))).toBe(
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
    expect(textOf(landed(blocks, outcome.changes))).toContain("Final words.");
  });
});

describe("a footnote, its definition in another block", () => {
  it("reads as its text, the same in an edit of its call's line as in the whole item", () => {
    const blocks = storedOf("One[^a] word.\n\nTwo.\n\n[^a]: secret\n");
    const whole = JSON.stringify([...blocks.values()].map(({ block }) => withoutId(block)));
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
    const blocks: BodyBlock[] = [{ block: table, section: "note" }];
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
