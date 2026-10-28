import { libraryChangeSchema } from "@repo/contract/cloud/library/library-wire";
import type { LibraryOp } from "@repo/notes/library/block-ops";
import type { LibraryBlock } from "@repo/notes/library/library-nodes";
import { describe, expect, it } from "vitest";

import {
  cellOf,
  clockAt,
  engineIn,
  hashOf,
  inCell,
  landedValue,
  noteFields,
  paragraph,
  person,
  placed,
  refusalOf,
  SYSTEM,
} from "../test-support/library-cell";
import type { CellActor } from "./cell-actor";
import { ITEM_TEXT_MAX_BYTES } from "./cell-landing";

const A = paragraph("a", "the first line");
const B = paragraph("b", "the second line");

const newItemId = (): string => crypto.randomUUID();

// what R2 holds of an image upload
const png = (bytes: number) => ({ bytes, mime: "image/png" });

// a highlight added over the first line, under one id
const highlightAdd = (text: string) =>
  ({
    createdAt: 1,
    id: "hl1",
    occurrence: null,
    op: "add",
    parentId: null,
    quote: "first",
    text,
  }) as const;

describe("a write to the library cell", () => {
  it("lands each block only over the hash it was read at, and answers a stale one with the block as it is", async () => {
    await inCell(cellOf(), (state) => {
      const library = engineIn(state, clockAt());
      const itemId = newItemId();
      const made = landedValue(
        library.create(person(), { blocks: placed([A, B]), fields: noteFields(), id: itemId }),
      );
      expect(made.item.seq).toBe(1);

      const edited = paragraph("a", "the first line, edited");
      const write = library.write(person("phone"), {
        itemId,
        ops: [{ baseHash: hashOf(A), block: edited, op: "put" }],
      });
      expect(write.ok && write.head).toBe(2);

      // a second writer read the first block before that edit, and the second block as it stands
      const stale = library.write(person("tablet"), {
        itemId,
        ops: [
          { baseHash: hashOf(B), block: paragraph("b", "landed only with the rest"), op: "put" },
          { baseHash: hashOf(A), block: paragraph("a", "a lost edit"), op: "put" },
        ],
      });
      expect(refusalOf(stale)).toEqual({
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
      const pulled = landedValue(library.bodies([itemId]));
      expect(pulled.bodies[0]?.blocks.map((stored) => stored.block)).toEqual([edited, B]);
    });
  });

  it("merges two writers' edits to different blocks with no conflict", async () => {
    await inCell(cellOf(), (state) => {
      const library = engineIn(state, clockAt());
      const itemId = newItemId();
      landedValue(
        library.create(person(), { blocks: placed([A, B]), fields: noteFields(), id: itemId }),
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
      const [body] = landedValue(library.bodies([itemId])).bodies;
      expect(body?.blocks.map((stored) => stored.block)).toEqual([first, second]);
    });
  });

  it("answers a resend by its op id with what landed, and moves nothing", async () => {
    await inCell(cellOf(), (state) => {
      const library = engineIn(state, clockAt());
      const itemId = newItemId();
      const opId = crypto.randomUUID();
      const first = library.create(person(), {
        blocks: placed([A]),
        fields: noteFields(),
        id: itemId,
        opId,
      });
      const again = library.create(person(), {
        blocks: placed([A]),
        fields: noteFields(),
        id: itemId,
        opId,
      });
      expect(first.ok && first.head).toBe(1);
      expect(again).toEqual({ head: null, ok: true, value: landedValue(first) });
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
      ).toThrow();
      expect(() => state.storage.sql.exec(`SELECT '${"x".repeat(100_001)}'`)).toThrow();

      const library = engineIn(state, clockAt());
      const itemId = newItemId();
      const blocks = Array.from({ length: 2000 }, (_, index) =>
        paragraph(`p${String(index)}`, `line ${String(index)}`),
      );
      landedValue(
        library.create(SYSTEM, { blocks: placed(blocks), fields: noteFields(), id: itemId }),
      );
      expect(landedValue(library.bodies([itemId])).bodies[0]?.blocks).toHaveLength(2000);
    });
  });

  it("refuses an item's text past 8 MiB as too large", async () => {
    await inCell(cellOf(), (state) => {
      const library = engineIn(state, clockAt());
      const line = "x".repeat(500 * 1024);
      const blocks = Array.from({ length: 17 }, (_, index) => paragraph(`p${String(index)}`, line));
      expect(17 * line.length).toBeGreaterThan(ITEM_TEXT_MAX_BYTES);
      const refused = library.create(SYSTEM, {
        blocks: placed(blocks),
        fields: noteFields(),
        id: newItemId(),
      });
      expect(refusalOf(refused)).toEqual({ kind: "too-large" });
      expect(library.head()).toBe(0);
    });
  });

  it("refuses a write past the account's cap with what it holds, and lands one that frees room", async () => {
    await inCell(cellOf(), (state) => {
      const roomy = engineIn(state, clockAt());
      const itemId = newItemId();
      landedValue(roomy.create(SYSTEM, { blocks: placed([A]), fields: noteFields(), id: itemId }));
      const bytesCap = state.storage.sql.databaseSize + 64 * 1024;
      const library = engineIn(state, clockAt(), bytesCap);
      const big = paragraph("big", "y".repeat(200 * 1024));
      const refused = library.write(SYSTEM, {
        itemId,
        ops: [{ block: big, op: "insert", ord: "a5", section: "note" }],
      });
      expect(refusalOf(refused)).toEqual({
        bytesCap,
        bytesUsed: state.storage.sql.databaseSize,
        kind: "quota",
      });
      landedValue(
        library.write(SYSTEM, { itemId, ops: [{ baseHash: hashOf(A), blockId: "a", op: "drop" }] }),
      );
    });
  });

  it("refuses a write naming a file the library does not hold, and lands it once the file is in", async () => {
    await inCell(cellOf(), (state) => {
      const library = engineIn(state, clockAt());
      const itemId = newItemId();
      landedValue(
        library.create(SYSTEM, { blocks: placed([A]), fields: noteFields(), id: itemId }),
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
      expect(refusalOf(library.write(SYSTEM, { itemId, ops: [insert] }))).toEqual({
        kind: "blob-missing",
        shas: [sha],
      });
      expect(landedValue(library.reserve({ bytes: 10, mime: "image/png", sha }))).toEqual({
        held: false,
      });
      const settled = library.settle(sha, { bytes: 10, mime: "image/png" }, library.blobRemovals());
      expect(settled.ok && settled.head).toBe(2);
      landedValue(library.write(SYSTEM, { itemId, ops: [insert] }));
      expect(landedValue(library.reserve({ bytes: 10, mime: "image/png", sha }))).toEqual({
        held: true,
      });
      const refs = state.storage.sql.exec("SELECT refs FROM blobs WHERE sha256 = ?", sha).one();
      expect(refs["refs"]).toBe(1);
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
      expect(landedValue(library.settle(sha, null, library.blobRemovals()))).toEqual({
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
      expect(state.storage.sql.exec("SELECT * FROM blob_uploads").toArray()).toEqual([]);
      // what R2 showed may be the refused bytes, or gone under the removal: nothing lands
      expect(landedValue(library.settle(sha, png(500), library.blobRemovals()))).toEqual({
        settled: false,
      });
      const before = library.blobRemovals();
      const removals = library.beginStrayRemovals();
      expect(removals.map((removal) => removal.sha)).toEqual([sha]);
      library.endStrayRemovals(removals, true);
      expect(library.beginStrayRemovals()).toEqual([]);
      // a settle that looked in R2 before the removal ended lands nothing; one after it lands
      expect(landedValue(library.settle(sha, png(500), before))).toEqual({ settled: false });
      const settled = library.settle(sha, png(500), library.blobRemovals());
      expect(settled).toEqual({ head: 1, ok: true, value: { settled: true } });
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
      expect(strays()).toEqual([
        { attempts: 0, id: `stray:${retried}` },
        { attempts: 0, id: `stray:${kept}` },
      ]);
      // a device asks for room again for one: its removal is called off
      landedValue(library.reserve({ bytes: 10, mime: "image/png", sha: kept }));
      const removals = library.beginStrayRemovals();
      expect(removals.map((removal) => removal.sha)).toEqual([retried]);
      // R2 failed the other: it waits its turn again, and the count of removals stays
      const count = library.blobRemovals();
      library.endStrayRemovals(removals, false);
      expect(strays()).toEqual([{ attempts: 1, id: `stray:${retried}` }]);
      expect(library.blobRemovals()).toBe(count);
      expect(library.beginStrayRemovals()).toEqual([]);
    });
  });

  it("guards a highlight's note by the text it was written over", async () => {
    await inCell(cellOf(), (state) => {
      const library = engineIn(state, clockAt());
      const itemId = newItemId();
      landedValue(
        library.create(person(), { blocks: placed([A]), fields: noteFields(), id: itemId }),
      );
      const add = {
        createdAt: 1,
        id: "hl1",
        occurrence: null,
        op: "add",
        parentId: null,
        quote: "first",
        text: "",
      } as const;
      landedValue(library.write(person(), { annotations: [add], itemId, ops: [] }));
      landedValue(
        library.write(person(), {
          annotations: [{ base: "", id: "hl1", op: "note", text: "a thought" }],
          itemId,
          ops: [],
        }),
      );
      const stale = library.write(person("phone"), {
        annotations: [{ base: "", id: "hl1", op: "note", text: "another thought" }],
        itemId,
        ops: [],
      });
      expect(refusalOf(stale)).toMatchObject({
        current: [
          { current: { source: "user", text: "a thought" }, id: "hl1", kind: "annotation" },
        ],
        kind: "conflict",
      });
    });
  });

  it("refuses a highlight whose id another item holds, and leaves that item's row as it is", async () => {
    await inCell(cellOf(), (state) => {
      const library = engineIn(state, clockAt());
      const first = newItemId();
      const second = newItemId();
      for (const id of [first, second]) {
        landedValue(library.create(person(), { blocks: placed([A]), fields: noteFields(), id }));
      }
      landedValue(
        library.write(person(), {
          annotations: [highlightAdd("on the first")],
          itemId: first,
          ops: [],
        }),
      );
      const head = library.head();
      const taken = library.write(person("phone"), {
        annotations: [highlightAdd("on the second")],
        itemId: second,
        ops: [],
      });
      expect(refusalOf(taken)).toMatchObject({
        current: [
          {
            current: { itemId: first, text: "on the first" },
            id: "hl1",
            itemId: second,
            kind: "annotation",
          },
        ],
        kind: "conflict",
      });
      expect(library.head()).toBe(head);
      expect(
        state.storage.sql.exec("SELECT item_id, text FROM annotations WHERE id = 'hl1'").toArray(),
      ).toEqual([{ item_id: first, text: "on the first" }]);
    });
  });
});

describe("pulling the library", () => {
  it("pages the change log to the head, every row as it is now, never ending inside a write", async () => {
    await inCell(cellOf(), (state) => {
      const library = engineIn(state, clockAt());
      const ids = Array.from({ length: 30 }, () => newItemId());
      for (const id of ids) {
        landedValue(library.create(SYSTEM, { blocks: placed([A]), fields: noteFields(), id }));
      }
      const first = landedValue(library.pull({ cursor: 0, epoch: null }));
      if (first.kind !== "changes") {
        throw new Error("a fresh replica pulls from the start");
      }
      expect(first.head).toBe(30);
      expect(first.more).toBe(false);
      expect(first.changes.map((change) => change.id).toSorted()).toEqual(ids.toSorted());
      for (const change of first.changes) {
        expect(libraryChangeSchema.parse(change)).toStrictEqual(change);
      }
      const after = landedValue(library.pull({ cursor: first.upto, epoch: first.epoch }));
      expect(after).toMatchObject({ changes: [], kind: "changes", more: false, upto: 30 });
    });
  });

  it("answers a replica of another library, or a cursor with no library behind it, with a reset", async () => {
    await inCell(cellOf(), (state) => {
      const library = engineIn(state, clockAt());
      landedValue(
        library.create(SYSTEM, { blocks: placed([A]), fields: noteFields(), id: newItemId() }),
      );
      const fresh = landedValue(library.pull({ cursor: 0, epoch: null }));
      expect(landedValue(library.pull({ cursor: 1, epoch: "another-library" }))).toEqual({
        epoch: fresh.epoch,
        kind: "reset",
      });
      expect(landedValue(library.pull({ cursor: 3, epoch: null }))).toEqual({
        epoch: fresh.epoch,
        kind: "reset",
      });
    });
  });

  it("sends bodies in the order asked, defers past the answer's size, and names an item with none", async () => {
    await inCell(cellOf(), (state) => {
      const library = engineIn(state, clockAt());
      const big = Array.from({ length: 6 }, (_, index) =>
        paragraph(`p${String(index)}`, "z".repeat(400 * 1024)),
      );
      const one = newItemId();
      const two = newItemId();
      landedValue(library.create(SYSTEM, { blocks: placed(big), fields: noteFields(), id: one }));
      landedValue(library.create(SYSTEM, { blocks: placed(big), fields: noteFields(), id: two }));
      const missing = newItemId();
      // past about 4 MB the rest waits for the next ask, the first body whatever its size
      const answer = landedValue(library.bodies([missing, one, two, one]));
      expect(answer).toMatchObject({ deferred: [one], gone: [missing] });
      expect(answer.bodies.map((body) => body.id)).toEqual([one, two]);
    });
  });
});

describe("change sets and undo", () => {
  it("joins a person's writes into one set until 15 s of quiet, then seals it with a revision", async () => {
    await inCell(cellOf(), (state) => {
      const clock = clockAt();
      const library = engineIn(state, clock);
      const itemId = newItemId();
      const start = clock.now;
      landedValue(
        library.create(person(), { blocks: placed([A]), fields: noteFields(), id: itemId }),
      );
      clock.now = start + 10_000;
      landedValue(
        library.write(person(), {
          itemId,
          ops: [{ baseHash: hashOf(A), block: paragraph("a", "typed on"), op: "put" }],
        }),
      );
      const sets = () => state.storage.sql.exec("SELECT id, sealed_at FROM change_sets").toArray();
      expect(sets()).toHaveLength(1);
      clock.now = start + 24_000;
      library.runDueJobs(() => {});
      expect(sets()[0]?.["sealed_at"]).toBeNull();
      expect(library.nextJobAt()).toBe(start + 25_000);
      clock.now = start + 25_000;
      library.runDueJobs(() => {});
      expect(sets()[0]?.["sealed_at"]).toBe(start + 25_000);
      const revisions = state.storage.sql
        .exec("SELECT rev FROM revisions WHERE item_id = ?", itemId)
        .toArray();
      expect(revisions).toEqual([{ rev: 1 }]);
    });
  });

  it("seals a person's set a minute after its first write however busy, and opens the next", async () => {
    await inCell(cellOf(), (state) => {
      const clock = clockAt();
      const library = engineIn(state, clock);
      const itemId = newItemId();
      const start = clock.now;
      landedValue(
        library.create(person(), { blocks: placed([A]), fields: noteFields(), id: itemId }),
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
      expect(sets).toEqual([
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
      landedValue(library.create(SYSTEM, { blocks: placed([A]), fields: noteFields(), id: kept }));
      landedValue(
        library.create(SYSTEM, { blocks: placed([A]), fields: noteFields(), id: undone }),
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
      const [laptopSet] = state.storage.sql
        .exec("SELECT id FROM change_sets WHERE device_id = 'laptop'")
        .toArray();
      const setId = String(laptopSet?.["id"]);
      // the phone changes one of the two again since
      clock.now += 120_000;
      landedValue(
        library.write(person("phone"), {
          itemId: kept,
          ops: [{ baseHash: hashOf(edit), block: paragraph("a", "the phone's edit"), op: "put" }],
        }),
      );
      const answer = landedValue(library.undo(person("laptop"), { changeSetIds: [setId] }));
      expect(answer.kept).toEqual([kept]);
      expect(answer.reverted).toEqual([undone]);
      const [body] = landedValue(library.bodies([undone])).bodies;
      expect(body?.blocks.map((stored) => stored.block)).toEqual([A]);
      expect(refusalOf(library.undo(person("laptop"), { changeSetIds: [setId] }))).toEqual({
        changeSetId: setId,
        kind: "already-undone",
        undoneBy: answer.changeSetId,
      });
      expect(refusalOf(library.undo(person(), { changeSetIds: [crypto.randomUUID()] }))).toEqual({
        kind: "not-found",
      });
    });
  });

  it("writes each revision when its state stops being the item's, so the newest is the item as it stands", async () => {
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
        library.create(SYSTEM, { blocks: placed([A]), fields: noteFields(), id: itemId }),
      );
      // the person's set stays open while the library's own write seals as it lands, then the
      // person takes the item back within the same set
      const typed = paragraph("a", "typed by the person");
      const later = paragraph("a", "a later system write");
      const again = paragraph("a", "the person again");
      clock.now = start + 1000;
      put(person(), A, typed);
      clock.now = start + 2000;
      put(SYSTEM, typed, later);
      clock.now = start + 3000;
      put(person(), later, again);
      clock.now = start + 62_000;
      library.runDueJobs(() => {});
      const revisions = state.storage.sql
        .exec("SELECT rev, at FROM revisions WHERE item_id = ? ORDER BY rev", itemId)
        .toArray();
      expect(revisions).toEqual([
        { at: start, rev: 1 },
        { at: start + 2000, rev: 2 },
        { at: start + 2000, rev: 3 },
        { at: start + 62_000, rev: 4 },
      ]);
      const blocksOf = (rev: number) =>
        landedValue(library.revision(itemId, rev))?.blocks.map((stored) => stored.block);
      expect([1, 2, 3, 4].map(blocksOf)).toEqual([[A], [typed], [later], [again]]);
      const [body] = landedValue(library.bodies([itemId])).bodies;
      expect(body?.blocks.map((stored) => stored.block)).toEqual(blocksOf(4));
    });
  });

  it("takes an item a set made to Deleted when its set is undone", async () => {
    await inCell(cellOf(), (state) => {
      const clock = clockAt();
      const library = engineIn(state, clock);
      const itemId = newItemId();
      landedValue(
        library.create(person(), { blocks: placed([A]), fields: noteFields(), id: itemId }),
      );
      const [set] = state.storage.sql.exec("SELECT id FROM change_sets").toArray();
      landedValue(library.undo(person(), { changeSetIds: [String(set?.["id"])] }));
      const pulled = landedValue(library.pull({ cursor: 0, epoch: null }));
      const row =
        pulled.kind === "changes" ? pulled.changes.find((change) => change.id === itemId) : null;
      expect(row?.row).toMatchObject({ fields: { deletedAt: clock.now }, kind: "live" });
    });
  });

  it("empties Deleted: the item stays a tombstone, its highlights and history go", async () => {
    await inCell(cellOf(), (state) => {
      const clock = clockAt();
      const library = engineIn(state, clock);
      const itemId = newItemId();
      landedValue(
        library.create(SYSTEM, { blocks: placed([A]), fields: noteFields(), id: itemId }),
      );
      landedValue(
        library.write(SYSTEM, {
          annotations: [
            {
              createdAt: 1,
              id: "hl",
              occurrence: null,
              op: "add",
              parentId: null,
              quote: "first",
              text: "",
            },
          ],
          itemId,
          ops: [{ base: null, field: "deletedAt", op: "set", value: clock.now }],
        }),
      );
      expect(landedValue(library.purgeItems({ ids: [itemId, newItemId()] })).purged).toEqual([
        itemId,
      ]);
      const pulled = landedValue(library.pull({ cursor: 0, epoch: null }));
      const changes = pulled.kind === "changes" ? pulled.changes : [];
      expect(changes.find((change) => change.id === itemId)?.row).toMatchObject({ kind: "purged" });
      expect(changes.find((change) => change.id === "hl")?.row).toBeNull();
      for (const table of ["revisions", "snapshot_parts", "block_versions", "change_set_items"]) {
        expect(
          state.storage.sql
            .exec(`SELECT count(*) AS n FROM ${table} WHERE item_id = ?`, itemId)
            .one()["n"],
        ).toBe(0);
      }
    });
  });
});
