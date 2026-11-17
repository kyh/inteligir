import { describe, expect, it } from "vitest";

import type { LibraryItemFields } from "@repo/contract/library/library-item";
import type { LibrarySocketFrame } from "@repo/contract/library/library-socket";
import { noteFixture, paragraph } from "@repo/contract/test-support/library-items";
import {
  blocksOf,
  cellOf,
  clockAt,
  createItem,
  cellIn,
  headOf,
  inCell,
  openTurn,
  landedValue,
  PERSON,
  placed,
  refusalOf,
  setFields,
  storedItemOf,
  undoableOf,
  undoFields,
  writeItem,
} from "../test-support/library-cell";
import { removalsOf } from "../test-support/library-files";
import type { CellActor } from "./cell-actor";
import { reserve, settle } from "./cell-blobs";
import { FILL_ACTOR } from "./cell-fills";
import { ITEM_TEXT_MAX_BYTES } from "./cell-landing";
import { UNDO_TURNS_MAX } from "./cell-undo";
import type { LibraryEngine } from "./library-engine";

const A = paragraph("a", "the first line");
const TITLE = "A note";

const newItemId = (): string => crypto.randomUUID();

// an undo's answer when nothing of what it named is left to take back
const NOTHING_LEFT = { kept: [], lostText: [], next: null, refused: [], reverted: [] };

const setCount = (state: DurableObjectState): number =>
  state.storage.sql.exec("SELECT id FROM change_sets").toArray().length;

// the items the change sets still hold an entry for
const entryItems = (state: DurableObjectState): unknown[] =>
  state.storage.sql
    .exec("SELECT item_id FROM change_set_items")
    .toArray()
    .map((row) => row.item_id);

const retitle = (library: LibraryEngine, actor: CellActor, itemId: string, title: string) => {
  landedValue(setFields(library, actor, itemId, { title }));
};

const titleOf = (library: LibraryEngine, itemId: string): string | null =>
  storedItemOf(library, itemId)?.fields.title ?? null;

const propertiesOf = (library: LibraryEngine, itemId: string) =>
  storedItemOf(library, itemId)?.fields.properties ?? null;

// a conversation a turn past one undo's lot, each turn renaming the one item: its thread
const longConversation = (cell: Parameters<typeof openTurn>[0], itemId: string): string => {
  let turn = openTurn(cell);
  for (let last = 1; ; last += 1) {
    retitle(cell.library, turn.actor, itemId, `Turn ${String(last)}`);
    turn.end();
    if (last > UNDO_TURNS_MAX) {
      return turn.actor.threadId;
    }
    turn = openTurn(cell, turn);
  }
};

describe("a write to the library cell", () => {
  it("lands each property only over the value it was read at, and lands nothing of a stale write", async () => {
    await inCell(cellOf(), (state) => {
      const cell = cellIn(state, { clock: clockAt() });
      const { library } = cell;
      const itemId = newItemId();
      const fields = noteFixture({ properties: { status: "draft" } });
      const made = landedValue(
        createItem(library, PERSON, { blocks: placed([A]), fields, id: itemId }),
      );
      expect(made.item.seq).toBe(1);

      const write = writeItem(library, PERSON, {
        itemId,
        ops: [{ base: "draft", key: "status", op: "property", value: "done" }],
      });
      expect(landedValue(write).item.seq).toBe(2);

      // a second writer read the status before that edit, and the rating as it stands
      const stale = writeItem(library, PERSON, {
        itemId,
        ops: [
          { key: "rating", op: "property", value: 5 },
          { base: "draft", key: "status", op: "property", value: "a lost edit" },
        ],
      });
      expect(refusalOf(stale)).toStrictEqual({ kind: "conflict" });
      // the whole write landed nothing: the head did not move, and the rating is as it was
      expect(headOf(library)).toBe(2);
      expect(propertiesOf(library, itemId)).toStrictEqual({ status: "done" });
    });
  });

  it("merges two writers' edits to different properties with no conflict", async () => {
    await inCell(cellOf(), (state) => {
      const cell = cellIn(state, { clock: clockAt() });
      const { library } = cell;
      const itemId = newItemId();
      landedValue(
        createItem(library, PERSON, { blocks: placed([A]), fields: noteFixture(), id: itemId }),
      );
      for (const [key, value] of Object.entries({
        rating: "From the phone",
        status: "From the laptop",
      })) {
        landedValue(writeItem(library, PERSON, { itemId, ops: [{ key, op: "property", value }] }));
      }
      expect(propertiesOf(library, itemId)).toStrictEqual({
        rating: "From the phone",
        status: "From the laptop",
      });
    });
  });

  it("refuses a property past the item's caps as too large, landing none of it", async () => {
    await inCell(cellOf(), (state) => {
      const cell = cellIn(state, { clock: clockAt() });
      const { library } = cell;
      const itemId = newItemId();
      const fields = noteFixture({ properties: { notes: "x".repeat(200 * 1024) } });
      landedValue(createItem(library, PERSON, { blocks: placed([A]), fields, id: itemId }));
      const more = { key: "more", op: "property", value: "y".repeat(100 * 1024) } as const;
      expect(refusalOf(writeItem(library, PERSON, { itemId, ops: [more] }))).toStrictEqual({
        kind: "too-large",
      });
      expect(headOf(library)).toBe(1);
    });
  });

  it("answers a resend by its op id with what landed, and moves nothing", async () => {
    await inCell(cellOf(), (state) => {
      const cell = cellIn(state, { clock: clockAt() });
      const { library } = cell;
      const itemId = newItemId();
      const opId = crypto.randomUUID();
      const first = createItem(library, PERSON, {
        blocks: placed([A]),
        fields: noteFixture(),
        id: itemId,
        opId,
      });
      const again = createItem(library, PERSON, {
        blocks: placed([A]),
        fields: noteFixture(),
        id: itemId,
        opId,
      });
      expect(landedValue(first).item.seq).toBe(1);
      expect(again).toStrictEqual({ ok: true, value: landedValue(first) });
      expect(headOf(library)).toBe(1);
    });
  });

  it("keeps thousands of blocks as a new item's seed, cut under a Durable Object's 100 bound parameters", async () => {
    await inCell(cellOf(), (state) => {
      // the engine's own limit, which the chunking must stay under
      expect(() =>
        state.storage.sql.exec(
          `SELECT ${Array.from({ length: 101 }, () => "?").join(", ")}`,
          ...Array.from({ length: 101 }, (_, index) => index),
        ),
      ).toThrow("too many SQL variables");
      expect(() => state.storage.sql.exec(`SELECT '${"x".repeat(100_001)}'`)).toThrow(
        "statement too long",
      );

      const cell = cellIn(state, { clock: clockAt() });
      const { library } = cell;
      const itemId = newItemId();
      const blocks = Array.from({ length: 2000 }, (_, index) =>
        paragraph(`p${String(index)}`, `line ${String(index)}`),
      );
      landedValue(
        createItem(library, FILL_ACTOR, {
          blocks: placed(blocks),
          fields: noteFixture(),
          id: itemId,
        }),
      );
      expect(blocksOf(library, itemId)).toHaveLength(2000);
    });
  });

  // its text is past 8 MiB on purpose
  it("refuses an item's text past 8 MiB as too large", { timeout: 30_000 }, async () => {
    await inCell(cellOf(), (state) => {
      const cell = cellIn(state, { clock: clockAt() });
      const { library } = cell;
      const line = "x".repeat(500 * 1024);
      const blocks = Array.from({ length: 17 }, (_, index) => paragraph(`p${String(index)}`, line));
      expect(17 * line.length).toBeGreaterThan(ITEM_TEXT_MAX_BYTES);
      const refused = createItem(library, FILL_ACTOR, {
        blocks: placed(blocks),
        fields: noteFixture(),
        id: newItemId(),
      });
      expect(refusalOf(refused)).toStrictEqual({ kind: "too-large" });
      expect(headOf(library)).toBe(0);
    });
  });

  it("refuses only a new item past the account's cap, with what it holds", async () => {
    await inCell(cellOf(), (state) => {
      const roomy = cellIn(state, { clock: clockAt() }).library;
      const itemId = newItemId();
      landedValue(
        createItem(roomy, FILL_ACTOR, { blocks: placed([A]), fields: noteFixture(), id: itemId }),
      );
      const bytesCap = state.storage.sql.databaseSize + 1024;
      const { library } = cellIn(state, { bytesCap, clock: clockAt() });
      const long = "y".repeat(8 * 1024);
      // a person never loses words to the cap in an item already there
      landedValue(
        writeItem(library, FILL_ACTOR, {
          itemId,
          ops: [{ key: "notes", op: "property", value: long }],
        }),
      );
      landedValue(setFields(library, FILL_ACTOR, itemId, { description: long }));
      const refusedNew = createItem(library, FILL_ACTOR, {
        blocks: placed([]),
        fields: noteFixture({ properties: { notes: long } }),
        id: newItemId(),
      });
      expect(refusalOf(refusedNew)).toStrictEqual({
        bytesCap,
        bytesUsed: state.storage.sql.databaseSize,
        kind: "quota",
      });
      const refusedSeed = createItem(library, FILL_ACTOR, {
        blocks: placed([paragraph("big", "y".repeat(8 * 1024))]),
        fields: noteFixture(),
        id: newItemId(),
      });
      expect(refusalOf(refusedSeed)).toMatchObject({ kind: "quota" });
    });
  });

  it("keeps a full library tidy: stamps, places and a shorter field land past the cap", async () => {
    await inCell(cellOf(), (state) => {
      const roomy = cellIn(state, { clock: clockAt() }).library;
      const itemId = newItemId();
      const title = "a title long enough to shorten";
      landedValue(
        createItem(roomy, FILL_ACTOR, {
          blocks: placed([A]),
          fields: noteFixture({ title }),
          id: itemId,
        }),
      );
      const { library } = cellIn(state, { bytesCap: 1, clock: clockAt() });
      for (const fields of [
        { title: "shorter" },
        { pinnedAt: 5 },
        { folderId: "folder" },
        { reading: { at: 6, error: "The page would not load.", state: "failed" } },
        { deletedAt: 7 },
      ] satisfies Partial<LibraryItemFields>[]) {
        landedValue(setFields(library, FILL_ACTOR, itemId, fields));
      }
      expect(
        state.storage.sql.exec("SELECT deleted_at FROM items WHERE id = ?", itemId).one(),
      ).toStrictEqual({ deleted_at: 7 });
    });
  });

  it("refuses a write naming a file the library does not hold, and lands it once the file is in", async () => {
    await inCell(cellOf(), (state) => {
      const cell = cellIn(state, { clock: clockAt() });
      const { library } = cell;
      const itemId = newItemId();
      landedValue(
        createItem(library, FILL_ACTOR, { blocks: placed([A]), fields: noteFixture(), id: itemId }),
      );
      const sha = "a".repeat(64);
      const cover = () => setFields(library, FILL_ACTOR, itemId, { coverSha: sha });
      expect(refusalOf(cover())).toStrictEqual({
        kind: "blob-missing",
        shas: [sha],
      });
      expect(landedValue(reserve(library, { bytes: 10, mime: "image/png", sha }))).toStrictEqual({
        held: false,
      });
      const settled = settle(library, sha, { bytes: 10, mime: "image/png" }, removalsOf(library));
      expect(landedValue(settled)).toBe("held");
      landedValue(cover());
      expect(landedValue(reserve(library, { bytes: 10, mime: "image/png", sha }))).toStrictEqual({
        held: true,
      });
      expect(
        state.storage.sql.exec("SELECT item_id FROM item_blobs WHERE sha256 = ?", sha).toArray(),
      ).toStrictEqual([{ item_id: itemId }]);
    });
  });
});

describe("change sets and undo", () => {
  it("keeps each turn of the built-in agent as one change set, its writes joined into one way back, sealed as the turn ends, and nobody else's writes", async () => {
    await inCell(cellOf(), (state) => {
      const cell = cellIn(state, { clock: clockAt() });
      const { library } = cell;
      const itemId = newItemId();
      landedValue(
        createItem(library, PERSON, { blocks: placed([A]), fields: noteFixture(), id: itemId }),
      );
      retitle(library, PERSON, itemId, "Typed by the person");
      retitle(library, FILL_ACTOR, itemId, "A reading");
      expect(setCount(state)).toBe(0);
      const turn = openTurn(cell);
      retitle(library, turn.actor, itemId, "The agent's title");
      retitle(library, turn.actor, itemId, "The agent's second title");
      const sets = () => state.storage.sql.exec("SELECT sealed_at FROM change_sets").toArray();
      expect(
        state.storage.sql
          .exec("SELECT made, inverse FROM change_set_items WHERE item_id = ?", itemId)
          .one(),
      ).toStrictEqual({
        inverse: JSON.stringify([
          { base: "The agent's second title", field: "title", op: "set", value: "A reading" },
        ]),
        made: null,
      });
      expect(sets()).toStrictEqual([{ sealed_at: null }]);
      turn.end();
      expect(sets()[0]?.sealed_at).not.toBeNull();
      expect(refusalOf(setFields(library, turn.actor, itemId, { title: "Late" }))).toStrictEqual({
        kind: "turn-ended",
      });
    });
  });

  it("undoes a turn, keeps an item edited since to undo again, and finds nothing left of what went back", async () => {
    await inCell(cellOf(), (state) => {
      const clock = clockAt();
      const frames: LibrarySocketFrame[] = [];
      const cell = cellIn(state, { clock, frames });
      const { library } = cell;
      const kept = newItemId();
      const undone = newItemId();
      for (const id of [kept, undone]) {
        landedValue(
          createItem(library, PERSON, { blocks: placed([A]), fields: noteFixture(), id }),
        );
      }
      const turn = openTurn(cell);
      const { threadId } = turn.actor;
      for (const itemId of [kept, undone]) {
        retitle(library, turn.actor, itemId, "The agent's title");
      }
      turn.end();
      expect(undoableOf(library, threadId)).toStrictEqual([1]);
      // the person changes one of the two again since
      clock.now += 120_000;
      retitle(library, PERSON, kept, "The person's title");
      const answer = landedValue(undoFields(library, turn.actor));
      expect(answer).toStrictEqual({ ...NOTHING_LEFT, kept: [kept], reverted: [undone] });
      expect(titleOf(library, undone)).toBe(TITLE);
      expect(titleOf(library, kept)).toBe("The person's title");
      // every device hears the thread moved, so each reads its undoable turns again
      expect(frames.at(-1)).toMatchObject({ threads: [threadId] });
      expect(entryItems(state)).toStrictEqual([kept]);
      expect(undoableOf(library, threadId)).toStrictEqual([1]);
      // the entry that went back is gone, so a second press takes back only what was kept
      const told = frames.length;
      expect(landedValue(undoFields(library, turn.actor))).toStrictEqual({
        ...NOTHING_LEFT,
        kept: [kept],
      });
      expect(titleOf(library, undone)).toBe(TITLE);
      expect(frames).toHaveLength(told);
      expect(landedValue(undoFields(library, { threadId, turn: 2 }))).toStrictEqual(NOTHING_LEFT);
      expect(landedValue(undoFields(library, { threadId: crypto.randomUUID() }))).toStrictEqual(
        NOTHING_LEFT,
      );
    });
  });

  it("takes nothing back of a turn still open, since what it did is not yet fixed", async () => {
    await inCell(cellOf(), (state) => {
      const cell = cellIn(state, { clock: clockAt() });
      const { library } = cell;
      const itemId = newItemId();
      landedValue(
        createItem(library, PERSON, { blocks: placed([A]), fields: noteFixture(), id: itemId }),
      );
      const turn = openTurn(cell);
      retitle(library, turn.actor, itemId, "The agent's title");
      expect(undoableOf(library, turn.actor.threadId)).toStrictEqual([]);
      expect(landedValue(undoFields(library, turn.actor))).toStrictEqual(NOTHING_LEFT);
      expect(titleOf(library, itemId)).toBe("The agent's title");
      turn.end();
      expect(landedValue(undoFields(library, turn.actor))).toMatchObject({ reverted: [itemId] });
    });
  });

  describe("an undo that takes nothing back", () => {
    it("leaves the turn undoable, and lands once the edit since is gone", async () => {
      await inCell(cellOf(), (state) => {
        const clock = clockAt();
        const cell = cellIn(state, { clock });
        const { library } = cell;
        const itemId = newItemId();
        landedValue(
          createItem(library, PERSON, { blocks: placed([A]), fields: noteFixture(), id: itemId }),
        );
        const turn = openTurn(cell);
        retitle(library, turn.actor, itemId, "The agent's title");
        turn.end();
        clock.now += 120_000;
        retitle(library, PERSON, itemId, "The person's title");

        const answer = landedValue(undoFields(library, turn.actor));
        expect(answer).toStrictEqual({ ...NOTHING_LEFT, kept: [itemId] });
        expect(undoableOf(library, turn.actor.threadId)).toStrictEqual([1]);

        retitle(library, PERSON, itemId, "The agent's title");
        const again = landedValue(undoFields(library, turn.actor));
        expect(again).toMatchObject({ kept: [], reverted: [itemId] });
        expect(undoableOf(library, turn.actor.threadId)).toStrictEqual([]);
      });
    });

    it("leaves undoable only the turns that kept something when one undo takes the conversation", async () => {
      await inCell(cellOf(), (state) => {
        const clock = clockAt();
        const cell = cellIn(state, { clock });
        const { library } = cell;
        const [held, back] = [newItemId(), newItemId()];
        for (const id of [held, back]) {
          landedValue(
            createItem(library, PERSON, { blocks: placed([A]), fields: noteFixture(), id }),
          );
        }
        const first = openTurn(cell);
        const { threadId } = first.actor;
        retitle(library, first.actor, held, "An edit");
        first.end();
        clock.now += 120_000;
        retitle(library, PERSON, held, "Edited again");
        const second = openTurn(cell, first);
        retitle(library, second.actor, back, "An edit");
        second.end();
        expect(undoableOf(library, threadId)).toStrictEqual([1, 2]);
        const answer = landedValue(undoFields(library, { threadId }));
        expect(answer).toStrictEqual({ ...NOTHING_LEFT, kept: [held], reverted: [back] });
        expect(undoableOf(library, threadId)).toStrictEqual([1]);
      });
    });
  });

  describe("an undo of a conversation of more turns than one call takes back", () => {
    it("goes newest first, a lot a call, each naming where the next starts", async () => {
      await inCell(cellOf(), (state) => {
        const cell = cellIn(state, { clock: clockAt() });
        const { library } = cell;
        const itemId = newItemId();
        landedValue(
          createItem(library, PERSON, { blocks: placed([A]), fields: noteFixture(), id: itemId }),
        );
        const threadId = longConversation(cell, itemId);
        const first = landedValue(undoFields(library, { threadId }));
        expect(first).toStrictEqual({ ...NOTHING_LEFT, next: 2, reverted: [itemId] });
        expect(titleOf(library, itemId)).toBe("Turn 1");
        expect(undoableOf(library, threadId)).toStrictEqual([1]);
        const rest = landedValue(undoFields(library, { before: 2, threadId }));
        expect(rest).toStrictEqual({ ...NOTHING_LEFT, reverted: [itemId] });
        expect(titleOf(library, itemId)).toBe(TITLE);
        expect(undoableOf(library, threadId)).toStrictEqual([]);
      });
    });

    it("moves past a lot that kept everything, which stays to undo again", async () => {
      await inCell(cellOf(), (state) => {
        const cell = cellIn(state, { clock: clockAt() });
        const { library } = cell;
        const itemId = newItemId();
        landedValue(
          createItem(library, PERSON, { blocks: placed([A]), fields: noteFixture(), id: itemId }),
        );
        const threadId = longConversation(cell, itemId);
        retitle(library, PERSON, itemId, "The person's title");
        const first = landedValue(undoFields(library, { threadId }));
        expect(first).toStrictEqual({ ...NOTHING_LEFT, kept: [itemId], next: 2 });
        const rest = landedValue(undoFields(library, { before: 2, threadId }));
        expect(rest).toStrictEqual({ ...NOTHING_LEFT, kept: [itemId] });
        expect(undoableOf(library, threadId)).toHaveLength(UNDO_TURNS_MAX + 1);
      });
    });
  });

  it("waits while another item holds the address, and lands once it no longer does", async () => {
    await inCell(cellOf(), (state) => {
      const clock = clockAt();
      const cell = cellIn(state, { clock });
      const { library } = cell;
      const url = "https://example.com/one";
      const gone = newItemId();
      const holder = newItemId();
      landedValue(
        createItem(library, PERSON, {
          blocks: placed([]),
          fields: noteFixture({ url }),
          id: gone,
        }),
      );
      const turn = openTurn(cell);
      landedValue(setFields(library, turn.actor, gone, { deletedAt: clock.now }));
      turn.end();
      landedValue(
        createItem(library, PERSON, {
          blocks: placed([]),
          fields: noteFixture({ url }),
          id: holder,
        }),
      );
      expect(refusalOf(undoFields(library, turn.actor))).toStrictEqual({ kind: "url-held" });
      expect(undoableOf(library, turn.actor.threadId)).toStrictEqual([1]);
      landedValue(setFields(library, PERSON, holder, { deletedAt: clock.now }));
      expect(landedValue(undoFields(library, turn.actor))).toMatchObject({
        refused: [],
        reverted: [gone],
      });
    });
  });

  it("keeps an edit the person made between two of the turn's writes of an item", async () => {
    await inCell(cellOf(), (state) => {
      const clock = clockAt();
      const cell = cellIn(state, { clock });
      const { library } = cell;
      const [pinned, renamed] = [newItemId(), newItemId()];
      for (const id of [pinned, renamed]) {
        landedValue(
          createItem(library, PERSON, { blocks: placed([A]), fields: noteFixture(), id }),
        );
      }
      const turn = openTurn(cell);
      for (const id of [pinned, renamed]) {
        retitle(library, turn.actor, id, "Typed by the agent");
      }
      landedValue(setFields(library, PERSON, pinned, { pinnedAt: clock.now }));
      retitle(library, PERSON, renamed, "Typed by the person");
      retitle(library, turn.actor, pinned, "The agent again");
      retitle(library, turn.actor, renamed, "The agent again");
      turn.end();
      const answer = landedValue(undoFields(library, turn.actor));
      expect(answer).toMatchObject({ kept: [], reverted: [pinned, renamed].toSorted() });
      expect(storedItemOf(library, pinned)).toMatchObject({
        fields: { pinnedAt: clock.now, title: TITLE },
      });
      expect(titleOf(library, renamed)).toBe("Typed by the person");
    });
  });

  it("takes an item a turn made to Deleted when its set is undone", async () => {
    await inCell(cellOf(), (state) => {
      const clock = clockAt();
      const cell = cellIn(state, { clock });
      const { library } = cell;
      const itemId = newItemId();
      const turn = openTurn(cell);
      landedValue(
        createItem(library, turn.actor, { blocks: placed([A]), fields: noteFixture(), id: itemId }),
      );
      turn.end();
      landedValue(undoFields(library, turn.actor));
      expect(storedItemOf(library, itemId)).toMatchObject({ fields: { deletedAt: clock.now } });
    });
  });

  it("empties Deleted: the item and what its change sets kept go, and its id is never made again", async () => {
    await inCell(cellOf(), async (state) => {
      const clock = clockAt();
      const cell = cellIn(state, { clock });
      const { client, library } = cell;
      const itemId = newItemId();
      const turn = openTurn(cell);
      landedValue(
        createItem(library, turn.actor, { blocks: placed([A]), fields: noteFixture(), id: itemId }),
      );
      landedValue(setFields(library, turn.actor, itemId, { deletedAt: clock.now }));
      turn.end();
      const emptied = await client.items.purge({ ids: [itemId, newItemId()] });
      expect(emptied.purged).toStrictEqual([itemId]);
      expect(storedItemOf(library, itemId)).toBeNull();
      expect(
        refusalOf(createItem(library, PERSON, { blocks: [], fields: noteFixture(), id: itemId })),
      ).toStrictEqual({ kind: "conflict" });
      for (const table of ["change_set_items", "change_set_blobs", "seed_blocks"]) {
        expect(
          state.storage.sql
            .exec(`SELECT count(*) AS n FROM ${table} WHERE item_id = ?`, itemId)
            .one().n,
        ).toBe(0);
      }
    });
  });
});
