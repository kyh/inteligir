import type { FieldOp } from "@repo/contract/library/field-ops";
import { describe, expect, it } from "vitest";

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
  storedItemOf,
  undoFields,
} from "../test-support/library-cell";
import type { CellActor } from "./cell-actor";
import { FILL_ACTOR } from "./cell-fills";
import { ITEM_TEXT_MAX_BYTES } from "./cell-landing";
import type { LibraryEngine } from "./library-engine";
import { z } from "zod";

const A = paragraph("a", "the first line");
const TITLE = "A note";

const newItemId = (): string => crypto.randomUUID();

const undoneAt = (state: DurableObjectState, id: string): number | null =>
  z
    .number()
    .nullable()
    .parse(
      state.storage.sql.exec("SELECT undone_at FROM change_sets WHERE id = ?", id).one().undone_at,
    );

const setCount = (state: DurableObjectState): number =>
  state.storage.sql.exec("SELECT id FROM change_sets").toArray().length;

const retitle = (
  library: LibraryEngine,
  actor: CellActor,
  itemId: string,
  from: string,
  to: string,
): void => {
  landedValue(
    library.write(actor, { itemId, ops: [{ base: from, field: "title", op: "set", value: to }] }),
  );
};

const titleOf = (library: LibraryEngine, itemId: string): string | null => {
  const item = storedItemOf(library, itemId);
  return item?.kind === "live" ? item.fields.title : null;
};

// what R2 holds of an image upload
const png = (bytes: number) => ({ bytes, mime: "image/png" });

describe("a write to the library cell", () => {
  it("lands each field only over the value it was read at, and answers a stale one with the field as it is", async () => {
    await inCell(cellOf(), (state) => {
      const cell = cellIn(state, { clock: clockAt() });
      const { library } = cell;
      const itemId = newItemId();
      const made = landedValue(
        createItem(library, PERSON, { blocks: placed([A]), fields: noteFixture(), id: itemId }),
      );
      expect(made.item.seq).toBe(1);

      const write = library.write(PERSON, {
        itemId,
        ops: [{ base: TITLE, field: "title", op: "set", value: "Edited" }],
      });
      expect(landedValue(write).item.seq).toBe(2);

      // a second writer read the title before that edit, and the description as it stands
      const stale = library.write(PERSON, {
        itemId,
        ops: [
          { base: null, field: "description", op: "set", value: "landed only with the rest" },
          { base: TITLE, field: "title", op: "set", value: "A lost edit" },
        ],
      });
      expect(refusalOf(stale)).toStrictEqual({ kind: "conflict" });
      // the whole write landed nothing: the head did not move, and the description is as it was
      expect(headOf(library)).toBe(2);
      expect(storedItemOf(library, itemId)).toMatchObject({
        fields: { description: null, title: "Edited" },
      });
    });
  });

  it("merges two writers' edits to different fields with no conflict", async () => {
    await inCell(cellOf(), (state) => {
      const cell = cellIn(state, { clock: clockAt() });
      const { library } = cell;
      const itemId = newItemId();
      landedValue(
        createItem(library, PERSON, { blocks: placed([A]), fields: noteFixture(), id: itemId }),
      );
      retitle(library, PERSON, itemId, TITLE, "From the laptop");
      landedValue(
        library.write(PERSON, {
          itemId,
          ops: [{ base: null, field: "description", op: "set", value: "From the phone" }],
        }),
      );
      expect(storedItemOf(library, itemId)).toMatchObject({
        fields: { description: "From the phone", title: "From the laptop" },
      });
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
        library.write(FILL_ACTOR, {
          itemId,
          ops: [{ key: "notes", op: "property", value: long }],
        }),
      );
      landedValue(
        library.write(FILL_ACTOR, {
          itemId,
          ops: [{ base: null, field: "description", op: "set", value: long }],
        }),
      );
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
      const landing = (ops: readonly FieldOp[]) =>
        landedValue(library.write(FILL_ACTOR, { itemId, ops }));
      landing([{ base: title, field: "title", op: "set", value: "shorter" }]);
      landing([{ base: null, field: "pinnedAt", op: "set", value: 5 }]);
      landing([{ base: null, field: "folderId", op: "set", value: "folder" }]);
      landing([{ base: "none", field: "fetchState", op: "set", value: "failed" }]);
      landing([{ base: null, field: "fetchError", op: "set", value: "The page would not load." }]);
      landing([{ base: null, field: "deletedAt", op: "set", value: 7 }]);
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
      const cover = { base: null, field: "coverSha", op: "set", value: sha } satisfies FieldOp;
      expect(refusalOf(library.write(FILL_ACTOR, { itemId, ops: [cover] }))).toStrictEqual({
        kind: "blob-missing",
        shas: [sha],
      });
      expect(landedValue(library.reserve({ bytes: 10, mime: "image/png", sha }))).toStrictEqual({
        held: false,
      });
      const settled = library.settle(sha, { bytes: 10, mime: "image/png" }, library.blobRemovals());
      expect(settled.ok && settled.value).toStrictEqual({ settled: true });
      landedValue(library.write(FILL_ACTOR, { itemId, ops: [cover] }));
      expect(landedValue(library.reserve({ bytes: 10, mime: "image/png", sha }))).toStrictEqual({
        held: true,
      });
      const refs = state.storage.sql.exec("SELECT refs FROM blobs WHERE sha256 = ?", sha).one();
      expect(refs.refs).toBe(1);
    });
  });

  it("holds room for an upload against the cap, and lets it go when nothing landed", async () => {
    await inCell(cellOf(), (state) => {
      const bytesCap = state.storage.sql.databaseSize + 1000;
      const { library } = cellIn(state, { bytesCap, clock: clockAt() });
      const sha = "b".repeat(64);
      expect(refusalOf(library.reserve({ bytes: 5000, mime: "image/png", sha }))).toMatchObject({
        bytesCap,
        kind: "quota",
      });
      landedValue(library.reserve({ bytes: 500, mime: "image/png", sha }));
      expect(
        refusalOf(library.reserve({ bytes: 600, mime: "image/png", sha: "c".repeat(64) })),
      ).toMatchObject({
        kind: "quota",
      });
      expect(landedValue(library.settle(sha, null, library.blobRemovals()))).toStrictEqual({
        settled: false,
      });
      landedValue(library.reserve({ bytes: 600, mime: "image/png", sha: "c".repeat(64) }));
    });
  });

  it("lets a refused upload's room go, takes its bytes out of R2, and lands the sha only once they are out", async () => {
    await inCell(cellOf(), (state) => {
      const bytesCap = state.storage.sql.databaseSize + 100_000;
      const { library } = cellIn(state, { bytesCap, clock: clockAt() });
      const sha = "e".repeat(64);
      landedValue(library.reserve({ ...png(500), sha }));
      expect(refusalOf(library.settle(sha, png(200_000), library.blobRemovals()))).toMatchObject({
        kind: "quota",
      });
      expect(state.storage.sql.exec("SELECT * FROM blob_uploads").toArray()).toStrictEqual([]);
      // what R2 showed may be the refused bytes, or gone under the removal: nothing lands
      expect(landedValue(library.settle(sha, png(500), library.blobRemovals()))).toStrictEqual({
        settled: false,
      });
      const before = library.blobRemovals();
      const removals = library.beginStrayRemovals();
      expect(removals.map((removal) => removal.sha)).toStrictEqual([sha]);
      library.endStrayRemovals(removals, true);
      expect(library.beginStrayRemovals()).toStrictEqual([]);
      // a settle that looked in R2 before the removal ended lands nothing; one after it lands
      expect(landedValue(library.settle(sha, png(500), before))).toStrictEqual({ settled: false });
      const settled = library.settle(sha, png(500), library.blobRemovals());
      expect(settled).toStrictEqual({
        ok: true,
        value: { settled: true },
      });
    });
  });

  it("takes out of R2 what an upload left once its room is let go, unless the sha is held again", async () => {
    await inCell(cellOf(), (state) => {
      const clock = clockAt();
      const cell = cellIn(state, { clock });
      const { library } = cell;
      const [kept, retried] = ["f".repeat(64), "0".repeat(64)];
      for (const sha of [kept, retried]) {
        landedValue(library.reserve({ bytes: 10, mime: "image/png", sha }));
      }
      clock.now += 60 * 60_000;
      library.runDueJobs(() => {});
      const strays = () =>
        state.storage.sql
          .exec("SELECT id, attempts FROM jobs WHERE kind = 'stray' ORDER BY id")
          .toArray();
      expect(strays()).toStrictEqual([
        { attempts: 0, id: `stray:${retried}` },
        { attempts: 0, id: `stray:${kept}` },
      ]);
      // a device asks for room again for one: its removal is called off
      landedValue(library.reserve({ bytes: 10, mime: "image/png", sha: kept }));
      const removals = library.beginStrayRemovals();
      expect(removals.map((removal) => removal.sha)).toStrictEqual([retried]);
      // R2 failed the other: it waits its turn again, and the count of removals stays
      const count = library.blobRemovals();
      library.endStrayRemovals(removals, false);
      expect(strays()).toStrictEqual([{ attempts: 1, id: `stray:${retried}` }]);
      expect(library.blobRemovals()).toBe(count);
      expect(library.beginStrayRemovals()).toStrictEqual([]);
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
      retitle(library, PERSON, itemId, TITLE, "Typed by the person");
      retitle(library, FILL_ACTOR, itemId, "Typed by the person", "A reading");
      expect(setCount(state)).toBe(0);
      const turn = openTurn(cell);
      retitle(library, turn.actor, itemId, "A reading", "The agent's title");
      retitle(library, turn.actor, itemId, "The agent's title", "The agent's second title");
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
      expect(
        refusalOf(
          library.write(turn.actor, {
            itemId,
            ops: [{ base: "The agent's second title", field: "title", op: "set", value: "Late" }],
          }),
        ),
      ).toStrictEqual({ kind: "turn-ended" });
    });
  });

  it("undoes sets newest first, keeps an item edited since, and refuses a second undo", async () => {
    await inCell(cellOf(), (state) => {
      const clock = clockAt();
      const cell = cellIn(state, { clock });
      const { library } = cell;
      const kept = newItemId();
      const undone = newItemId();
      for (const id of [kept, undone]) {
        landedValue(
          createItem(library, PERSON, { blocks: placed([A]), fields: noteFixture(), id }),
        );
      }
      const turn = openTurn(cell);
      for (const itemId of [kept, undone]) {
        retitle(library, turn.actor, itemId, TITLE, "The agent's title");
      }
      turn.end();
      const setId = turn.setId();
      // the person changes one of the two again since
      clock.now += 120_000;
      retitle(library, PERSON, kept, "The agent's title", "The person's title");
      const answer = landedValue(undoFields(library, [setId]));
      expect(answer.kept).toStrictEqual([kept]);
      expect(answer.reverted).toStrictEqual([undone]);
      expect(titleOf(library, undone)).toBe(TITLE);
      expect(titleOf(library, kept)).toBe("The person's title");
      expect(undoneAt(state, setId)).toBe(clock.now);
      expect(setCount(state)).toBe(1);
      expect(refusalOf(undoFields(library, [setId]))).toStrictEqual({
        changeSetId: setId,
        kind: "already-undone",
      });
      expect(refusalOf(undoFields(library, [crypto.randomUUID()]))).toStrictEqual({
        kind: "not-found",
      });
    });
  });

  it("refuses to undo a turn still open, since what it did is not yet fixed", async () => {
    await inCell(cellOf(), (state) => {
      const cell = cellIn(state, { clock: clockAt() });
      const { library } = cell;
      const itemId = newItemId();
      landedValue(
        createItem(library, PERSON, { blocks: placed([A]), fields: noteFixture(), id: itemId }),
      );
      const turn = openTurn(cell);
      retitle(library, turn.actor, itemId, TITLE, "The agent's title");
      const setId = turn.setId();
      expect(refusalOf(undoFields(library, [setId]))).toStrictEqual({ kind: "conflict" });
      expect(titleOf(library, itemId)).toBe("The agent's title");
      turn.end();
      expect(landedValue(undoFields(library, [setId]))).toMatchObject({ reverted: [itemId] });
    });
  });

  describe("an undo that takes nothing back", () => {
    it("leaves the set undoable, and lands once the edit since is gone", async () => {
      await inCell(cellOf(), (state) => {
        const clock = clockAt();
        const cell = cellIn(state, { clock });
        const { library } = cell;
        const itemId = newItemId();
        landedValue(
          createItem(library, PERSON, { blocks: placed([A]), fields: noteFixture(), id: itemId }),
        );
        const turn = openTurn(cell);
        retitle(library, turn.actor, itemId, TITLE, "The agent's title");
        turn.end();
        const setId = turn.setId();
        clock.now += 120_000;
        retitle(library, PERSON, itemId, "The agent's title", "The person's title");

        const answer = landedValue(undoFields(library, [setId]));
        expect(answer).toStrictEqual({ kept: [itemId], lostText: [], refused: [], reverted: [] });
        expect(undoneAt(state, setId)).toBeNull();

        retitle(library, PERSON, itemId, "The person's title", "The agent's title");
        const again = landedValue(undoFields(library, [setId]));
        expect(again).toMatchObject({ kept: [], reverted: [itemId] });
        expect(undoneAt(state, setId)).toBe(clock.now);
      });
    });

    it("marks only the sets that took something back when one undo names several", async () => {
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
        retitle(library, first.actor, held, TITLE, "An edit");
        first.end();
        clock.now += 120_000;
        retitle(library, PERSON, held, "An edit", "Edited again");
        const second = openTurn(cell);
        retitle(library, second.actor, back, TITLE, "An edit");
        second.end();
        const [heldSet, backSet] = [first.setId(), second.setId()];
        const answer = landedValue(undoFields(library, [heldSet, backSet]));
        expect(answer).toMatchObject({ kept: [held], refused: [], reverted: [back] });
        expect(undoneAt(state, backSet)).toBe(clock.now);
        expect(undoneAt(state, heldSet)).toBeNull();
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
      landedValue(
        library.write(turn.actor, {
          itemId: gone,
          ops: [{ base: null, field: "deletedAt", op: "set", value: clock.now }],
        }),
      );
      turn.end();
      const setId = turn.setId();
      landedValue(
        createItem(library, PERSON, {
          blocks: placed([]),
          fields: noteFixture({ url }),
          id: holder,
        }),
      );
      expect(refusalOf(undoFields(library, [setId]))).toStrictEqual({ kind: "url-held" });
      expect(undoneAt(state, setId)).toBeNull();
      landedValue(
        library.write(PERSON, {
          itemId: holder,
          ops: [{ base: null, field: "deletedAt", op: "set", value: clock.now }],
        }),
      );
      expect(landedValue(undoFields(library, [setId]))).toMatchObject({
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
        retitle(library, turn.actor, id, TITLE, "Typed by the agent");
      }
      landedValue(
        library.write(PERSON, {
          itemId: pinned,
          ops: [{ base: null, field: "pinnedAt", op: "set", value: clock.now }],
        }),
      );
      retitle(library, PERSON, renamed, "Typed by the agent", "Typed by the person");
      retitle(library, turn.actor, pinned, "Typed by the agent", "The agent again");
      retitle(library, turn.actor, renamed, "Typed by the person", "The agent again");
      turn.end();
      const answer = landedValue(undoFields(library, [turn.setId()]));
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
      landedValue(undoFields(library, [turn.setId()]));
      expect(storedItemOf(library, itemId)).toMatchObject({
        fields: { deletedAt: clock.now },
        kind: "live",
      });
    });
  });

  it("empties Deleted: the item stays a tombstone, and what its change sets kept goes", async () => {
    await inCell(cellOf(), (state) => {
      const clock = clockAt();
      const cell = cellIn(state, { clock });
      const { library } = cell;
      const itemId = newItemId();
      const turn = openTurn(cell);
      landedValue(
        createItem(library, turn.actor, { blocks: placed([A]), fields: noteFixture(), id: itemId }),
      );
      landedValue(
        library.write(turn.actor, {
          itemId,
          ops: [{ base: null, field: "deletedAt", op: "set", value: clock.now }],
        }),
      );
      turn.end();
      expect(landedValue(library.purgeItems({ ids: [itemId, newItemId()] })).purged).toStrictEqual([
        itemId,
      ]);
      expect(storedItemOf(library, itemId)).toMatchObject({ kind: "purged" });
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

describe("the cell's alarm", () => {
  it("drops a job whose payload its kind no longer reads, so no run fails on it again", async () => {
    await inCell(cellOf(), (state) => {
      const clock = clockAt();
      const cell = cellIn(state, { clock });
      const { library } = cell;
      for (const [id, kind] of [
        ["upload:unread", "upload"],
        ["stray:unread", "stray"],
      ] as const) {
        state.storage.sql.exec(
          "INSERT INTO jobs (id, kind, payload, attempts, next_at) VALUES (?, ?, '{}', 0, ?)",
          id,
          kind,
          clock.now,
        );
      }
      const failed: string[] = [];
      library.runDueJobs((job) => {
        failed.push(job.id);
      });
      expect(library.beginStrayRemovals()).toStrictEqual([]);
      expect(failed).toStrictEqual([]);
      expect(state.storage.sql.exec("SELECT id FROM jobs").toArray()).toStrictEqual([]);
    });
  });
});
