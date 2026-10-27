import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { applyOps } from "@repo/notes/library/block-ops";
import type { ItemState, StoredBlock } from "@repo/notes/library/block-ops";
import { blockHash } from "@repo/notes/library/block-hash";
import { compareBlockPlaces } from "@repo/notes/library/block-order";
import type { LibraryItemFields } from "@repo/notes/library/library-item";

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
    copySha: null,
    coverSha: null,
    deletedAt: null,
    description: null,
    fetchError: null,
    fetchState: "none",
    fetchedAt: null,
    folderId: null,
    kind: "note",
    lang: null,
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

describe("the agent's view of an item", () => {
  it("writes a link with its item's live title and id", () => {
    expect(textOf(storedOf(NOTE))).toContain(`[[Other note|${OTHER_ID}]]`);
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
        expect(whole.kind === "changed" ? whole.ops : whole, `${dir}/${file}`).toEqual([]);
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
    expect(outcome.ops).toEqual([expect.objectContaining({ baseHash: last?.hash, op: "put" })]);
    const after = landed(blocks, outcome.ops);
    expect([...after.keys()]).toEqual([...blocks.keys()]);
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
    expect(outcome.ops.map((op) => op.op)).toEqual(["insert"]);
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

  it("drops a block it deleted", () => {
    const blocks = storedOf(NOTE);
    const outcome = editItemView(blocks, [{ newText: "", oldText: "\n\nLast line." }], portsWith());
    expect(outcome.kind === "changed" ? outcome.ops.map((op) => op.op) : outcome).toEqual(["drop"]);
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

  it("refuses an old text it cannot place once", () => {
    const blocks = storedOf(NOTE);
    expect(editItemView(blocks, [{ newText: "x", oldText: "" }], portsWith())).toEqual({
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
    expect(outcome.ops.map((op) => op.op)).toEqual(["put"]);
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
    expect(outcome.ops).toEqual([expect.objectContaining({ op: "insert", section: "note" })]);
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
    expect(outcome.ops.map((op) => op.op)).toEqual(["put", "put"]);
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

  it("names a quote no passage matches", () => {
    const placed = placeItemQuotes(
      storedOf(NOTE),
      [{ id: "q2", quote: "nowhere to be read" }],
      portsWith(),
    );
    expect(placed).toMatchObject({ missing: ["q2"], ops: [], placed: [] });
  });
});
