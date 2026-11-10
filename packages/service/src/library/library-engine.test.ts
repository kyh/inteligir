import type { FieldOp } from "@repo/contract/library/field-ops";
import { describe, expect, it } from "vitest";

import {
  blocksOf,
  cellOf,
  clockAt,
  createItem,
  engineIn,
  inCell,
  landedValue,
  noteFields,
  paragraph,
  person,
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

const laptopSet = (state: DurableObjectState): string => {
  const [row] = state.storage.sql
    .exec("SELECT id FROM change_sets WHERE session_id = 'laptop'")
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
      const library = engineIn(state, clockAt());
      const itemId = newItemId();
      const made = landedValue(
        createItem(library, person(), { blocks: placed([A]), fields: noteFields(), id: itemId }),
      );
      expect(made.item.seq).toBe(1);

      const write = library.write(person("phone"), {
        itemId,
        ops: [{ base: TITLE, field: "title", op: "set", value: "Edited" }],
      });
      expect(landedValue(write).item.seq).toBe(2);

      // a second writer read the title before that edit, and the description as it stands
      const stale = library.write(person("tablet"), {
        itemId,
        ops: [
          { base: null, field: "description", op: "set", value: "landed only with the rest" },
          { base: TITLE, field: "title", op: "set", value: "A lost edit" },
        ],
      });
      expect(refusalOf(stale)).toStrictEqual({
        current: [{ current: "Edited", field: "title", itemId, kind: "field" }],
        kind: "conflict",
      });
      // the whole write landed nothing: the head did not move, and the description is as it was
      expect(library.head()).toBe(2);
      expect(storedItemOf(library, itemId)).toMatchObject({
        fields: { description: null, title: "Edited" },
      });
    });
  });

  it("merges two writers' edits to different fields with no conflict", async () => {
    await inCell(cellOf(), (state) => {
      const library = engineIn(state, clockAt());
      const itemId = newItemId();
      landedValue(
        createItem(library, person(), { blocks: placed([A]), fields: noteFields(), id: itemId }),
      );
      retitle(library, person("laptop"), itemId, TITLE, "From the laptop");
      landedValue(
        library.write(person("phone"), {
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

  it("refuses only a new item past the account's cap, with what it holds", async () => {
    await inCell(cellOf(), (state) => {
      const roomy = engineIn(state, clockAt());
      const itemId = newItemId();
      landedValue(
        createItem(roomy, FILL_ACTOR, { blocks: placed([A]), fields: noteFields(), id: itemId }),
      );
      const bytesCap = state.storage.sql.databaseSize + 1024;
      const library = engineIn(state, clockAt(), bytesCap);
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
        fields: noteFields({ properties: { notes: long } }),
        id: newItemId(),
      });
      expect(refusalOf(refusedNew)).toStrictEqual({
        bytesCap,
        bytesUsed: state.storage.sql.databaseSize,
        kind: "quota",
      });
      const refusedSeed = createItem(library, FILL_ACTOR, {
        blocks: placed([paragraph("big", "y".repeat(8 * 1024))]),
        fields: noteFields(),
        id: newItemId(),
      });
      expect(refusalOf(refusedSeed)).toMatchObject({ kind: "quota" });
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
      const library = engineIn(state, clockAt());
      const itemId = newItemId();
      landedValue(
        createItem(library, FILL_ACTOR, { blocks: placed([A]), fields: noteFields(), id: itemId }),
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
      retitle(library, person(), itemId, TITLE, "Typed on");
      const sets = () => state.storage.sql.exec("SELECT id, sealed_at FROM change_sets").toArray();
      const after = () =>
        state.storage.sql
          .exec("SELECT after_fields FROM change_set_items WHERE item_id = ?", itemId)
          .one().after_fields;
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
      let title = TITLE;
      for (const at of [10_000, 20_000, 30_000, 40_000, 50_000]) {
        clock.now = start + at;
        const next = `Typed at ${String(at)}`;
        retitle(library, person(), itemId, title, next);
        title = next;
      }
      expect(library.nextJobAt()).toBe(start + 60_000);
      clock.now = start + 60_000;
      library.runDueJobs(() => {});
      clock.now = start + 61_000;
      retitle(library, person(), itemId, title, "After the cap");
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
      for (const id of [kept, undone]) {
        landedValue(
          createItem(library, FILL_ACTOR, { blocks: placed([A]), fields: noteFields(), id }),
        );
      }
      for (const itemId of [kept, undone]) {
        retitle(library, person("laptop"), itemId, TITLE, "The laptop's title");
      }
      const setId = laptopSet(state);
      // the phone changes one of the two again since
      clock.now += 120_000;
      retitle(library, person("phone"), kept, "The laptop's title", "The phone's title");
      const answer = landedValue(undoFields(library, person("laptop"), [setId]));
      expect(answer.kept).toStrictEqual([kept]);
      expect(answer.reverted).toStrictEqual([undone]);
      expect(titleOf(library, undone)).toBe(TITLE);
      expect(titleOf(library, kept)).toBe("The phone's title");
      expect(refusalOf(undoFields(library, person("laptop"), [setId]))).toStrictEqual({
        changeSetId: setId,
        kind: "already-undone",
        undoneBy: answer.changeSetId,
      });
      expect(refusalOf(undoFields(library, person(), [crypto.randomUUID()]))).toStrictEqual({
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
        retitle(library, person("laptop"), itemId, TITLE, "The laptop's title");
        const setId = laptopSet(state);
        clock.now += 120_000;
        retitle(library, person("phone"), itemId, "The laptop's title", "The phone's title");
        const sets = setCount(state);

        const answer = landedValue(undoFields(library, person("laptop"), [setId]));
        expect(answer).toStrictEqual({
          changeSetId: null,
          kept: [itemId],
          lostText: [],
          refused: [],
          reverted: [],
        });
        expect(undoneBy(state, setId)).toBeNull();
        expect(setCount(state)).toBe(sets);

        retitle(library, person("phone"), itemId, "The phone's title", "The laptop's title");
        const again = landedValue(undoFields(library, person("laptop"), [setId]));
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
        retitle(library, person("laptop"), held, TITLE, "An edit");
        const heldSet = laptopSet(state);
        clock.now += 120_000;
        retitle(library, person("tablet"), held, "An edit", "Edited again");
        retitle(library, person("phone"), back, TITLE, "An edit");
        const backSet = z
          .string()
          .parse(
            state.storage.sql.exec("SELECT id FROM change_sets WHERE session_id = 'phone'").one()
              .id,
          );
        const answer = landedValue(undoFields(library, person("laptop"), [heldSet, backSet]));
        expect(answer).toMatchObject({ kept: [held], refused: [], reverted: [back] });
        expect(undoneBy(state, backSet)).toBe(answer.changeSetId);
        expect(undoneBy(state, heldSet)).toBeNull();
      });
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
      expect(refusalOf(undoFields(library, person("laptop"), [setId]))).toMatchObject({
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
      expect(landedValue(undoFields(library, person("laptop"), [setId]))).toMatchObject({
        refused: [],
        reverted: [gone],
      });
    });
  });

  it("writes each set's after when its state stops being the item's, so each is the item as that set left it", async () => {
    await inCell(cellOf(), (state) => {
      const clock = clockAt();
      const library = engineIn(state, clock);
      const itemId = newItemId();
      const start = clock.now;
      landedValue(
        createItem(library, FILL_ACTOR, { blocks: placed([A]), fields: noteFields(), id: itemId }),
      );
      // the person's set stays open while a reading's write seals as it lands, then the person
      // takes the item back within the same set
      clock.now = start + 1000;
      retitle(library, person(), itemId, TITLE, "Typed by the person");
      clock.now = start + 2000;
      retitle(library, FILL_ACTOR, itemId, "Typed by the person", "A later reading");
      clock.now = start + 3000;
      retitle(library, person(), itemId, "A later reading", "The person again");
      clock.now = start + 62_000;
      library.runDueJobs(() => {});
      const titleSchema = z.object({ title: z.string() });
      const afters = state.storage.sql
        .exec(
          `SELECT sets.actor AS actor, parts.json AS fields
           FROM change_set_items items JOIN change_sets sets ON sets.id = items.change_set_id
           JOIN snapshot_parts parts ON parts.item_id = items.item_id
             AND parts.hash = items.after_fields
           WHERE items.item_id = ? ORDER BY sets.opened_at`,
          itemId,
        )
        .toArray()
        .map((row) => ({
          actor: row.actor,
          title: titleSchema.parse(JSON.parse(z.string().parse(row.fields))).title,
        }));
      // the reading that made the item, the person's set, and the reading in its middle
      expect(afters).toStrictEqual([
        { actor: "fill", title: TITLE },
        { actor: "person", title: "The person again" },
        { actor: "fill", title: "A later reading" },
      ]);
      expect(titleOf(library, itemId)).toBe("The person again");
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
      landedValue(undoFields(library, person(), [z.string().parse(set?.id)]));
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
      for (const table of ["snapshot_parts", "change_set_items", "seed_blocks"]) {
        expect(
          state.storage.sql
            .exec(`SELECT count(*) AS n FROM ${table} WHERE item_id = ?`, itemId)
            .one().n,
        ).toBe(0);
      }
    });
  });
});
