import type { LibraryOp } from "@repo/notes/library/block-ops";
import type { LibraryBlock } from "@repo/notes/library/library-nodes";
import { describe, expect, it } from "vitest";

import {
  blocksOf,
  cellOf,
  clockAt,
  createItem,
  engineIn,
  hashOf,
  inCell,
  landedValue,
  noteFields,
  paragraph,
  person,
  placed,
  refusalOf,
  storedItemOf,
} from "../test-support/library-cell";
import type { CellActor } from "./cell-actor";
import { FILL_ACTOR } from "./cell-fills";
import { ITEM_TEXT_MAX_BYTES } from "./cell-landing";
import { z } from "zod";

const A = paragraph("a", "the first line");
const B = paragraph("b", "the second line");

const newItemId = (): string => crypto.randomUUID();

const laptopSet = (state: DurableObjectState): string => {
  const [row] = state.storage.sql
    .exec("SELECT id FROM change_sets WHERE device_id = 'laptop'")
    .toArray();
  return z.string().parse(row?.id);
};

const undoneBy = (state: DurableObjectState, id: string): string | null =>
  z
    .string()
    .nullable()
    .parse(
      state.storage.sql.exec("SELECT undone_by FROM change_sets WHERE id = ?", id).one().undone_by,
    );

const setCount = (state: DurableObjectState): number =>
  state.storage.sql.exec("SELECT id FROM change_sets").toArray().length;

// what R2 holds of an image upload
const png = (bytes: number) => ({ bytes, mime: "image/png" });

describe("a write to the library cell", () => {
  it("lands each block only over the hash it was read at, and answers a stale one with the block as it is", async () => {
    await inCell(cellOf(), (state) => {
      const library = engineIn(state, clockAt());
      const itemId = newItemId();
      const made = landedValue(
        createItem(library, person(), { blocks: placed([A, B]), fields: noteFields(), id: itemId }),
      );
      expect(made.item.seq).toBe(1);

      const edited = paragraph("a", "the first line, edited");
      const write = library.write(person("phone"), {
        itemId,
        ops: [{ baseHash: hashOf(A), block: edited, op: "put" }],
      });
      expect(landedValue(write).item.seq).toBe(2);

      // a second writer read the first block before that edit, and the second block as it stands
      const stale = library.write(person("tablet"), {
        itemId,
        ops: [
          { baseHash: hashOf(B), block: paragraph("b", "landed only with the rest"), op: "put" },
          { baseHash: hashOf(A), block: paragraph("a", "a lost edit"), op: "put" },
        ],
      });
      expect(refusalOf(stale)).toStrictEqual({
        current: [
          {
            blockId: "a",
            current: {
              block: edited,
              hash: hashOf(edited),
              ord: expect.any(String),
              section: "note",
            },
            itemId,
            kind: "block",
          },
        ],
        kind: "conflict",
      });
      // the whole write landed nothing: the head did not move, and the second block is as it was
      expect(library.head()).toBe(2);
      expect(blocksOf(library, itemId)).toStrictEqual([edited, B]);
    });
  });

  it("merges two writers' edits to different blocks with no conflict", async () => {
    await inCell(cellOf(), (state) => {
      const library = engineIn(state, clockAt());
      const itemId = newItemId();
      landedValue(
        createItem(library, person(), { blocks: placed([A, B]), fields: noteFields(), id: itemId }),
      );
      const first = paragraph("a", "from the laptop");
      const second = paragraph("b", "from the phone");
      landedValue(
        library.write(person("laptop"), {
          itemId,
          ops: [{ baseHash: hashOf(A), block: first, op: "put" }],
        }),
      );
      landedValue(
        library.write(person("phone"), {
          itemId,
          ops: [{ baseHash: hashOf(B), block: second, op: "put" }],
        }),
      );
      expect(blocksOf(library, itemId)).toStrictEqual([first, second]);
    });
  });

  it("answers a resend by its op id with what landed, and moves nothing", async () => {
    await inCell(cellOf(), (state) => {
      const library = engineIn(state, clockAt());
      const itemId = newItemId();
      const opId = crypto.randomUUID();
      const first = createItem(library, person(), {
        blocks: placed([A]),
        fields: noteFields(),
        id: itemId,
        opId,
      });
      const again = createItem(library, person(), {
        blocks: placed([A]),
        fields: noteFields(),
        id: itemId,
        opId,
      });
      expect(landedValue(first).item.seq).toBe(1);
      expect(again).toStrictEqual({ moved: null, ok: true, value: landedValue(first) });
      expect(library.head()).toBe(1);
    });
  });

  it("lands thousands of blocks in one write, cut under a Durable Object's 100 bound parameters", async () => {
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

      const library = engineIn(state, clockAt());
      const itemId = newItemId();
      const blocks = Array.from({ length: 2000 }, (_, index) =>
        paragraph(`p${String(index)}`, `line ${String(index)}`),
      );
      landedValue(
        createItem(library, FILL_ACTOR, {
          blocks: placed(blocks),
          fields: noteFields(),
          id: itemId,
        }),
      );
      expect(blocksOf(library, itemId)).toHaveLength(2000);
    });
  });

  // its text is past 8 MiB on purpose
  it("refuses an item's text past 8 MiB as too large", { timeout: 30_000 }, async () => {
    await inCell(cellOf(), (state) => {
      const library = engineIn(state, clockAt());
      const line = "x".repeat(500 * 1024);
      const blocks = Array.from({ length: 17 }, (_, index) => paragraph(`p${String(index)}`, line));
      expect(17 * line.length).toBeGreaterThan(ITEM_TEXT_MAX_BYTES);
      const refused = createItem(library, FILL_ACTOR, {
        blocks: placed(blocks),
        fields: noteFields(),
        id: newItemId(),
      });
      expect(refusalOf(refused)).toStrictEqual({ kind: "too-large" });
      expect(library.head()).toBe(0);
    });
  });

  it("refuses a write past the account's cap with what it holds, and lands one that frees room", async () => {
    await inCell(cellOf(), (state) => {
      const roomy = engineIn(state, clockAt());
      const itemId = newItemId();
      landedValue(
        createItem(roomy, FILL_ACTOR, { blocks: placed([A]), fields: noteFields(), id: itemId }),
      );
      const bytesCap = state.storage.sql.databaseSize + 64 * 1024;
      const library = engineIn(state, clockAt(), bytesCap);
      const big = paragraph("big", "y".repeat(200 * 1024));
      const refused = library.write(FILL_ACTOR, {
        itemId,
        ops: [{ block: big, op: "insert", ord: "a5", section: "note" }],
      });
      expect(refusalOf(refused)).toStrictEqual({
        bytesCap,
        bytesUsed: state.storage.sql.databaseSize,
        kind: "quota",
      });
      landedValue(
        library.write(FILL_ACTOR, {
          itemId,
          ops: [{ baseHash: hashOf(A), blockId: "a", op: "drop" }],
        }),
      );
    });
  });

  it("counts the words a field holds toward the cap, new items included", async () => {
    await inCell(cellOf(), (state) => {
      const roomy = engineIn(state, clockAt());
      const itemId = newItemId();
      landedValue(
        createItem(roomy, FILL_ACTOR, { blocks: placed([A]), fields: noteFields(), id: itemId }),
      );
      const bytesCap = state.storage.sql.databaseSize + 1024;
      const library = engineIn(state, clockAt(), bytesCap);
      const long = "y".repeat(8 * 1024);
      const refusedProperty = library.write(FILL_ACTOR, {
        itemId,
        ops: [{ key: "notes", op: "property", value: long }],
      });
      expect(refusalOf(refusedProperty)).toMatchObject({ bytesCap, kind: "quota" });
      const refusedDescription = library.write(FILL_ACTOR, {
        itemId,
        ops: [{ base: null, field: "description", op: "set", value: long }],
      });
      expect(refusalOf(refusedDescription)).toMatchObject({ kind: "quota" });
      const refusedNew = createItem(library, FILL_ACTOR, {
        blocks: placed([]),
        fields: noteFields({ properties: { notes: long } }),
        id: newItemId(),
      });
      expect(refusalOf(refusedNew)).toMatchObject({ kind: "quota" });
    });
  });

  it("keeps a full library tidy: stamps, places and a shorter field land past the cap", async () => {
    await inCell(cellOf(), (state) => {
      const roomy = engineIn(state, clockAt());
      const itemId = newItemId();
      const title = "a title long enough to shorten";
      landedValue(
        createItem(roomy, FILL_ACTOR, {
          blocks: placed([A]),
          fields: noteFields({ title }),
          id: itemId,
        }),
      );
      const library = engineIn(state, clockAt(), 1);
      const landing = (ops: readonly LibraryOp[]) =>
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
      const library = engineIn(state, clockAt());
      const itemId = newItemId();
      landedValue(
        createItem(library, FILL_ACTOR, { blocks: placed([A]), fields: noteFields(), id: itemId }),
      );
      const sha = "a".repeat(64);
      const image = {
        children: [{ text: "" }],
        id: "img",
        sha,
        type: "img",
      } satisfies LibraryBlock;
      const insert = {
        block: image,
        op: "insert",
        ord: "a5",
        section: "note",
      } satisfies LibraryOp;
      expect(refusalOf(library.write(FILL_ACTOR, { itemId, ops: [insert] }))).toStrictEqual({
        kind: "blob-missing",
        shas: [sha],
      });
      expect(landedValue(library.reserve({ bytes: 10, mime: "image/png", sha }))).toStrictEqual({
        held: false,
      });
      const settled = library.settle(sha, { bytes: 10, mime: "image/png" }, library.blobRemovals());
      expect(settled.ok && settled.value).toStrictEqual({ settled: true });
      landedValue(library.write(FILL_ACTOR, { itemId, ops: [insert] }));
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
      const library = engineIn(state, clockAt(), bytesCap);
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
      const library = engineIn(state, clockAt(), bytesCap);
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
        moved: null,
        ok: true,
        value: { settled: true },
      });
    });
  });

  it("takes out of R2 what an upload left once its room is let go, unless the sha is held again", async () => {
    await inCell(cellOf(), (state) => {
      const clock = clockAt();
      const library = engineIn(state, clock);
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
  it("joins a person's writes into one set until 15 s of quiet, then seals it with its after", async () => {
    await inCell(cellOf(), (state) => {
      const clock = clockAt();
      const library = engineIn(state, clock);
      const itemId = newItemId();
      const start = clock.now;
      landedValue(
        createItem(library, person(), { blocks: placed([A]), fields: noteFields(), id: itemId }),
      );
      clock.now = start + 10_000;
      landedValue(
        library.write(person(), {
          itemId,
          ops: [{ baseHash: hashOf(A), block: paragraph("a", "typed on"), op: "put" }],
        }),
      );
      const sets = () => state.storage.sql.exec("SELECT id, sealed_at FROM change_sets").toArray();
      const after = () =>
        state.storage.sql
          .exec("SELECT after_manifest FROM change_set_items WHERE item_id = ?", itemId)
          .one().after_manifest;
      expect(sets()).toHaveLength(1);
      clock.now = start + 24_000;
      library.runDueJobs(() => {});
      expect(sets()[0]?.sealed_at).toBeNull();
      expect(after()).toBeNull();
      expect(library.nextJobAt()).toBe(start + 25_000);
      clock.now = start + 25_000;
      library.runDueJobs(() => {});
      expect(sets()[0]?.sealed_at).toBe(start + 25_000);
      expect(after()).not.toBeNull();
    });
  });

  it("seals a person's set a minute after its first write however busy, and opens the next", async () => {
    await inCell(cellOf(), (state) => {
      const clock = clockAt();
      const library = engineIn(state, clock);
      const itemId = newItemId();
      const start = clock.now;
      landedValue(
        createItem(library, person(), { blocks: placed([A]), fields: noteFields(), id: itemId }),
      );
      let block = A;
      for (const at of [10_000, 20_000, 30_000, 40_000, 50_000]) {
        clock.now = start + at;
        const next = paragraph("a", `typed at ${String(at)}`);
        landedValue(
          library.write(person(), {
            itemId,
            ops: [{ baseHash: hashOf(block), block: next, op: "put" }],
          }),
        );
        block = next;
      }
      expect(library.nextJobAt()).toBe(start + 60_000);
      clock.now = start + 60_000;
      library.runDueJobs(() => {});
      clock.now = start + 61_000;
      landedValue(
        library.write(person(), {
          itemId,
          ops: [{ baseHash: hashOf(block), block: paragraph("a", "after the cap"), op: "put" }],
        }),
      );
      const sets = state.storage.sql
        .exec("SELECT opened_at, sealed_at FROM change_sets ORDER BY opened_at")
        .toArray();
      expect(sets).toStrictEqual([
        { opened_at: start, sealed_at: start + 60_000 },
        { opened_at: start + 61_000, sealed_at: null },
      ]);
    });
  });

  it("undoes sets newest first in one of its own, keeps an item edited since, and refuses a second undo", async () => {
    await inCell(cellOf(), (state) => {
      const clock = clockAt();
      const library = engineIn(state, clock);
      const kept = newItemId();
      const undone = newItemId();
      landedValue(
        createItem(library, FILL_ACTOR, { blocks: placed([A]), fields: noteFields(), id: kept }),
      );
      landedValue(
        createItem(library, FILL_ACTOR, { blocks: placed([A]), fields: noteFields(), id: undone }),
      );
      const edit = paragraph("a", "the laptop's edit");
      for (const itemId of [kept, undone]) {
        landedValue(
          library.write(person("laptop"), {
            itemId,
            ops: [{ baseHash: hashOf(A), block: edit, op: "put" }],
          }),
        );
      }
      const setId = laptopSet(state);
      // the phone changes one of the two again since
      clock.now += 120_000;
      landedValue(
        library.write(person("phone"), {
          itemId: kept,
          ops: [{ baseHash: hashOf(edit), block: paragraph("a", "the phone's edit"), op: "put" }],
        }),
      );
      const answer = landedValue(library.undo(person("laptop"), { changeSetIds: [setId] }));
      expect(answer.kept).toStrictEqual([kept]);
      expect(answer.reverted).toStrictEqual([undone]);
      expect(blocksOf(library, undone)).toStrictEqual([A]);
      expect(refusalOf(library.undo(person("laptop"), { changeSetIds: [setId] }))).toStrictEqual({
        changeSetId: setId,
        kind: "already-undone",
        undoneBy: answer.changeSetId,
      });
      expect(
        refusalOf(library.undo(person(), { changeSetIds: [crypto.randomUUID()] })),
      ).toStrictEqual({
        kind: "not-found",
      });
    });
  });

  describe("an undo that takes nothing back", () => {
    it("leaves the set undoable, opens no set of its own, and lands once the edit since is gone", async () => {
      await inCell(cellOf(), (state) => {
        const clock = clockAt();
        const library = engineIn(state, clock);
        const itemId = newItemId();
        landedValue(
          createItem(library, FILL_ACTOR, {
            blocks: placed([A]),
            fields: noteFields(),
            id: itemId,
          }),
        );
        const edit = paragraph("a", "the laptop's edit");
        const later = paragraph("a", "the phone's edit");
        landedValue(
          library.write(person("laptop"), {
            itemId,
            ops: [{ baseHash: hashOf(A), block: edit, op: "put" }],
          }),
        );
        const setId = laptopSet(state);
        clock.now += 120_000;
        landedValue(
          library.write(person("phone"), {
            itemId,
            ops: [{ baseHash: hashOf(edit), block: later, op: "put" }],
          }),
        );
        const sets = setCount(state);

        const answer = landedValue(library.undo(person("laptop"), { changeSetIds: [setId] }));
        expect(answer).toStrictEqual({
          changeSetId: null,
          kept: [itemId],
          refused: [],
          reverted: [],
        });
        expect(undoneBy(state, setId)).toBeNull();
        expect(setCount(state)).toBe(sets);

        landedValue(
          library.write(person("phone"), {
            itemId,
            ops: [{ baseHash: hashOf(later), block: edit, op: "put" }],
          }),
        );
        const again = landedValue(library.undo(person("laptop"), { changeSetIds: [setId] }));
        expect(again).toMatchObject({ kept: [], reverted: [itemId] });
        expect(undoneBy(state, setId)).toBe(again.changeSetId);
      });
    });

    it("marks only the sets that took something back when one undo names several", async () => {
      await inCell(cellOf(), (state) => {
        const clock = clockAt();
        const library = engineIn(state, clock);
        const [held, back] = [newItemId(), newItemId()];
        for (const id of [held, back]) {
          landedValue(
            createItem(library, FILL_ACTOR, { blocks: placed([A]), fields: noteFields(), id }),
          );
        }
        const edit = paragraph("a", "an edit");
        landedValue(
          library.write(person("laptop"), {
            itemId: held,
            ops: [{ baseHash: hashOf(A), block: edit, op: "put" }],
          }),
        );
        const heldSet = laptopSet(state);
        clock.now += 120_000;
        landedValue(
          library.write(person("tablet"), {
            itemId: held,
            ops: [{ baseHash: hashOf(edit), block: paragraph("a", "edited again"), op: "put" }],
          }),
        );
        landedValue(
          library.write(person("phone"), {
            itemId: back,
            ops: [{ baseHash: hashOf(A), block: edit, op: "put" }],
          }),
        );
        const backSet = z
          .string()
          .parse(
            state.storage.sql.exec("SELECT id FROM change_sets WHERE device_id = 'phone'").one().id,
          );
        const answer = landedValue(
          library.undo(person("laptop"), { changeSetIds: [heldSet, backSet] }),
        );
        expect(answer).toMatchObject({ kept: [held], refused: [], reverted: [back] });
        expect(undoneBy(state, backSet)).toBe(answer.changeSetId);
        expect(undoneBy(state, heldSet)).toBeNull();
      });
    });
  });

  describe("an undo a rule refuses", () => {
    const passage = paragraph("long", "x".repeat(4096));

    it("answers why and stays undoable while every item's way back is refused", async () => {
      await inCell(cellOf(), (state) => {
        const clock = clockAt();
        const roomy = engineIn(state, clock);
        const itemId = newItemId();
        landedValue(
          createItem(roomy, FILL_ACTOR, {
            blocks: placed([A, passage]),
            fields: noteFields(),
            id: itemId,
          }),
        );
        landedValue(
          roomy.write(person("laptop"), {
            itemId,
            ops: [{ baseHash: hashOf(passage), blockId: "long", op: "drop" }],
          }),
        );
        const setId = laptopSet(state);
        const sets = setCount(state);
        const full = engineIn(state, clock, 1);
        expect(refusalOf(full.undo(person("laptop"), { changeSetIds: [setId] }))).toMatchObject({
          kind: "quota",
        });
        expect(undoneBy(state, setId)).toBeNull();
        expect(setCount(state)).toBe(sets);
        const answer = landedValue(roomy.undo(person("laptop"), { changeSetIds: [setId] }));
        expect(answer).toMatchObject({ kept: [], refused: [], reverted: [itemId] });
        expect(blocksOf(roomy, itemId)).toStrictEqual([A, passage]);
        expect(undoneBy(state, setId)).toBe(answer.changeSetId);
      });
    });

    it("lands what it can, names the rest, and a second try takes the rest back", async () => {
      await inCell(cellOf(), (state) => {
        const clock = clockAt();
        const roomy = engineIn(state, clock);
        const cut = newItemId();
        const added = newItemId();
        landedValue(
          createItem(roomy, FILL_ACTOR, {
            blocks: placed([A, passage]),
            fields: noteFields(),
            id: cut,
          }),
        );
        landedValue(
          createItem(roomy, FILL_ACTOR, { blocks: placed([A]), fields: noteFields(), id: added }),
        );
        landedValue(
          roomy.write(person("laptop"), {
            itemId: cut,
            ops: [{ baseHash: hashOf(passage), blockId: "long", op: "drop" }],
          }),
        );
        landedValue(
          roomy.write(person("laptop"), {
            itemId: added,
            ops: [{ block: B, op: "insert", ord: "a5", section: "note" }],
          }),
        );
        const setId = laptopSet(state);
        const full = engineIn(state, clock, 1);
        const partial = landedValue(full.undo(person("laptop"), { changeSetIds: [setId] }));
        expect(partial).toMatchObject({ kept: [], refused: [cut], reverted: [added] });
        expect(undoneBy(state, setId)).toBeNull();
        expect(blocksOf(roomy, added)).toStrictEqual([A]);
        const rest = landedValue(roomy.undo(person("laptop"), { changeSetIds: [setId] }));
        expect(rest).toMatchObject({ kept: [], refused: [] });
        expect(rest.reverted).toContain(cut);
        expect(blocksOf(roomy, cut)).toStrictEqual([A, passage]);
        expect(undoneBy(state, setId)).toBe(rest.changeSetId);
      });
    });

    it("answers why when the only other set named has nothing to take back", async () => {
      await inCell(cellOf(), (state) => {
        const clock = clockAt();
        const roomy = engineIn(state, clock);
        const [cut, held] = [newItemId(), newItemId()];
        landedValue(
          createItem(roomy, FILL_ACTOR, {
            blocks: placed([A, passage]),
            fields: noteFields(),
            id: cut,
          }),
        );
        landedValue(
          createItem(roomy, FILL_ACTOR, { blocks: placed([A]), fields: noteFields(), id: held }),
        );
        const edit = paragraph("a", "an edit");
        landedValue(
          roomy.write(person("laptop"), {
            itemId: held,
            ops: [{ baseHash: hashOf(A), block: edit, op: "put" }],
          }),
        );
        const heldSet = laptopSet(state);
        clock.now += 120_000;
        landedValue(
          roomy.write(person("tablet"), {
            itemId: held,
            ops: [{ baseHash: hashOf(edit), block: paragraph("a", "edited again"), op: "put" }],
          }),
        );
        landedValue(
          roomy.write(person("phone"), {
            itemId: cut,
            ops: [{ baseHash: hashOf(passage), blockId: "long", op: "drop" }],
          }),
        );
        const cutSet = z
          .string()
          .parse(
            state.storage.sql.exec("SELECT id FROM change_sets WHERE device_id = 'phone'").one().id,
          );
        const sets = setCount(state);

        const full = engineIn(state, clock, 1);
        expect(
          refusalOf(full.undo(person("laptop"), { changeSetIds: [heldSet, cutSet] })),
        ).toMatchObject({ kind: "quota" });
        expect(undoneBy(state, heldSet)).toBeNull();
        expect(undoneBy(state, cutSet)).toBeNull();
        expect(setCount(state)).toBe(sets);
      });
    });

    it("waits while another item holds the address, and lands once it no longer does", async () => {
      await inCell(cellOf(), (state) => {
        const clock = clockAt();
        const library = engineIn(state, clock);
        const url = "https://example.com/one";
        const gone = newItemId();
        const holder = newItemId();
        landedValue(
          createItem(library, FILL_ACTOR, {
            blocks: placed([]),
            fields: noteFields({ url }),
            id: gone,
          }),
        );
        landedValue(
          library.write(person("laptop"), {
            itemId: gone,
            ops: [{ base: null, field: "deletedAt", op: "set", value: clock.now }],
          }),
        );
        const setId = laptopSet(state);
        landedValue(
          createItem(library, FILL_ACTOR, {
            blocks: placed([]),
            fields: noteFields({ url }),
            id: holder,
          }),
        );
        expect(refusalOf(library.undo(person("laptop"), { changeSetIds: [setId] }))).toMatchObject({
          itemId: holder,
          kind: "url-held",
        });
        expect(undoneBy(state, setId)).toBeNull();
        landedValue(
          library.write(FILL_ACTOR, {
            itemId: holder,
            ops: [{ base: null, field: "deletedAt", op: "set", value: clock.now }],
          }),
        );
        expect(
          landedValue(library.undo(person("laptop"), { changeSetIds: [setId] })),
        ).toMatchObject({ refused: [], reverted: [gone] });
      });
    });
  });

  it("writes each set's after when its state stops being the item's, so each is the item as that set left it", async () => {
    await inCell(cellOf(), (state) => {
      const clock = clockAt();
      const library = engineIn(state, clock);
      const itemId = newItemId();
      const start = clock.now;
      const put = (actor: CellActor, from: LibraryBlock, block: LibraryBlock): void => {
        landedValue(
          library.write(actor, { itemId, ops: [{ baseHash: hashOf(from), block, op: "put" }] }),
        );
      };
      landedValue(
        createItem(library, FILL_ACTOR, { blocks: placed([A]), fields: noteFields(), id: itemId }),
      );
      // the person's set stays open while a reading's write seals as it lands, then the person
      // takes the item back within the same set
      const typed = paragraph("a", "typed by the person");
      const later = paragraph("a", "a later reading");
      const again = paragraph("a", "the person again");
      clock.now = start + 1000;
      put(person(), A, typed);
      clock.now = start + 2000;
      put(FILL_ACTOR, typed, later);
      clock.now = start + 3000;
      put(person(), later, again);
      clock.now = start + 62_000;
      library.runDueJobs(() => {});
      const manifestSchema = z.array(z.tuple([z.string(), z.string(), z.string(), z.string()]));
      const afters = state.storage.sql
        .exec(
          `SELECT sets.actor AS actor, parts.json AS manifest
           FROM change_set_items items JOIN change_sets sets ON sets.id = items.change_set_id
           JOIN snapshot_parts parts ON parts.item_id = items.item_id
             AND parts.hash = items.after_manifest
           WHERE items.item_id = ? ORDER BY sets.opened_at`,
          itemId,
        )
        .toArray()
        .map((row) => ({
          actor: row.actor,
          hashes: manifestSchema
            .parse(JSON.parse(z.string().parse(row.manifest)))
            .map(([, hash]) => hash),
        }));
      // the reading that made the item, the person's set, and the reading in its middle
      expect(afters).toStrictEqual([
        { actor: "fill", hashes: [hashOf(A)] },
        { actor: "person", hashes: [hashOf(again)] },
        { actor: "fill", hashes: [hashOf(later)] },
      ]);
      expect(blocksOf(library, itemId)).toStrictEqual([again]);
    });
  });

  it("takes an item a set made to Deleted when its set is undone", async () => {
    await inCell(cellOf(), (state) => {
      const clock = clockAt();
      const library = engineIn(state, clock);
      const itemId = newItemId();
      landedValue(
        createItem(library, person(), { blocks: placed([A]), fields: noteFields(), id: itemId }),
      );
      const [set] = state.storage.sql.exec("SELECT id FROM change_sets").toArray();
      landedValue(library.undo(person(), { changeSetIds: [z.string().parse(set?.id)] }));
      expect(storedItemOf(library, itemId)).toMatchObject({
        fields: { deletedAt: clock.now },
        kind: "live",
      });
    });
  });

  it("empties Deleted: the item stays a tombstone, and what its change sets kept goes", async () => {
    await inCell(cellOf(), (state) => {
      const clock = clockAt();
      const library = engineIn(state, clock);
      const itemId = newItemId();
      landedValue(
        createItem(library, FILL_ACTOR, { blocks: placed([A]), fields: noteFields(), id: itemId }),
      );
      landedValue(
        library.write(FILL_ACTOR, {
          itemId,
          ops: [{ base: null, field: "deletedAt", op: "set", value: clock.now }],
        }),
      );
      expect(landedValue(library.purgeItems({ ids: [itemId, newItemId()] })).purged).toStrictEqual([
        itemId,
      ]);
      expect(storedItemOf(library, itemId)).toMatchObject({ kind: "purged" });
      for (const table of ["snapshot_parts", "block_versions", "change_set_items"]) {
        expect(
          state.storage.sql
            .exec(`SELECT count(*) AS n FROM ${table} WHERE item_id = ?`, itemId)
            .one().n,
        ).toBe(0);
      }
    });
  });
});
