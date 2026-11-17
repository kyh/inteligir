// A file past the item that named it, driven through the verbs a device calls, the cell's own
// write of a cover and the alarm's jobs: it stays while an item or any change set names it, and
// once nothing does it leaves the library, the quota and R2. And a file on its way in: its room
// held against the cap, what a refused or abandoned upload left taken out of R2, and its row
// settled while the alarm takes another out.

import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";

import { pngOf } from "../fill/test-support/fill-cell";
import {
  cellIn,
  cellOf,
  clockAt,
  inCell,
  landedValue,
  openTurn,
  PERSON,
  refusalOf,
  setFields,
} from "../test-support/library-cell";
import type { Clock } from "../test-support/library-cell";
import { removalsOf, uploadedFile } from "../test-support/library-files";
import type { CellActor } from "./cell-actor";
import { runJobs, runKind } from "./cell-alarm";
import { blobKey, endRemoval, reserve, settle, settleStored } from "./cell-blobs";

const DAY = 24 * 60 * 60_000;

const png = (width: number) => ({ bytes: pngOf(width, 600), mime: "image/png" });

type Cell = ReturnType<typeof cellIn> & {
  readonly clock: Clock;
  readonly state: DurableObjectState;
};

const inLibrary = async <T>(run: (cell: Cell) => Promise<T>): Promise<T> =>
  await inCell(cellOf(), async (state) => {
    const clock = clockAt(Date.now());
    return await run({ ...cellIn(state, { clock }), clock, state });
  });

const fileItem = async ({ client, clock, library }: Cell, sha: string): Promise<string> => {
  const { item } = await client.items.createFile({
    folderId: null,
    id: library.ids.item(),
    name: "picture.png",
    savedAt: clock.now,
    sha,
    tags: [],
  });
  return item.id;
};

const noteItem = async ({ client, clock, library }: Cell): Promise<string> => {
  const { item } = await client.items.create({
    blocks: [],
    folderId: null,
    id: library.ids.item(),
    savedAt: clock.now,
    tags: [],
    title: "A note",
  });
  return item.id;
};

const setCover = ({ library }: Cell, actor: CellActor, itemId: string, coverSha: string): void => {
  landedValue(setFields(library, actor, itemId, { coverSha }));
};

const purge = async ({ client }: Cell, itemId: string): Promise<void> => {
  await client.items.delete({ ids: [itemId] });
  await client.items.purge({ ids: [itemId] });
};

const fileRows = ({ state }: Cell, sha: string): number =>
  state.storage.sql.exec("SELECT 1 FROM blobs WHERE sha256 = ?", sha).toArray().length;

// the files' bytes the quota counts: every file's row, and every upload's room
const bytesUsed = ({ state }: Cell): number => {
  const row = state.storage.sql
    .exec(
      `SELECT (SELECT coalesce(sum(bytes), 0) FROM blobs)
            + (SELECT coalesce(sum(bytes), 0) FROM blob_uploads) AS bytes`,
    )
    .one();
  return Number(row.bytes);
};

const inR2 = async ({ accountId }: Cell, sha: string): Promise<boolean> =>
  (await env.BLOBS.head(blobKey(accountId, sha))) !== null;

describe("a file nothing names any more", () => {
  it("leaves the library, the quota and R2 once the one item naming it is deleted for good", async () => {
    await inLibrary(async (cell) => {
      const file = png(1200);
      const sha = await uploadedFile(cell.library, cell.accountId, file);
      const itemId = await fileItem(cell, sha);
      expect(bytesUsed(cell)).toBe(file.bytes.length);
      await purge(cell, itemId);
      await runJobs(cell);
      expect(fileRows(cell, sha)).toBe(0);
      expect(bytesUsed(cell)).toBe(0);
      await expect(inR2(cell, sha)).resolves.toBe(false);
    });
  });

  it("stays while another item names it, and goes with the last", async () => {
    await inLibrary(async (cell) => {
      const sha = await uploadedFile(cell.library, cell.accountId, png(1200));
      const first = await fileItem(cell, sha);
      const second = await fileItem(cell, sha);
      await purge(cell, first);
      await runJobs(cell);
      expect(fileRows(cell, sha)).toBe(1);
      await expect(inR2(cell, sha)).resolves.toBe(true);
      await purge(cell, second);
      await runJobs(cell);
      expect(fileRows(cell, sha)).toBe(0);
    });
  });

  it("stays while another item's change set names it, and goes with that item", async () => {
    await inLibrary(async (cell) => {
      const [old, fresh] = [
        await uploadedFile(cell.library, cell.accountId, png(1200)),
        await uploadedFile(cell.library, cell.accountId, png(1300)),
      ];
      const fileHolder = await fileItem(cell, old);
      const note = await noteItem(cell);
      setCover(cell, PERSON, note, old);
      // the agent's turn replaces it, so its set keeps the cover it found
      const turn = openTurn(cell);
      setCover(cell, turn.actor, note, fresh);
      turn.end();
      await purge(cell, fileHolder);
      await runJobs(cell);
      expect(fileRows(cell, old)).toBe(1);
      await expect(inR2(cell, old)).resolves.toBe(true);
      // the note's change set alone names the old cover, and that goes with the note
      await purge(cell, note);
      await runJobs(cell);
      expect(fileRows(cell, old)).toBe(0);
      expect(fileRows(cell, fresh)).toBe(0);
      expect(bytesUsed(cell)).toBe(0);
    });
  });

  it("waits out a day once a write replaced it within one change, which no change set kept", async () => {
    await inLibrary(async (cell) => {
      const [first, second] = [
        await uploadedFile(cell.library, cell.accountId, png(1200)),
        await uploadedFile(cell.library, cell.accountId, png(1300)),
      ];
      const note = await noteItem(cell);
      setCover(cell, PERSON, note, first);
      setCover(cell, PERSON, note, second);
      await runJobs(cell);
      expect(fileRows(cell, first)).toBe(1);
      cell.clock.now += DAY;
      await runJobs(cell);
      expect(fileRows(cell, first)).toBe(0);
      expect(fileRows(cell, second)).toBe(1);
    });
  });

  it("goes once the prune drops the last change set naming it", async () => {
    await inLibrary(async (cell) => {
      const { clock, library } = cell;
      const [old, fresh] = [
        await uploadedFile(library, cell.accountId, png(1200)),
        await uploadedFile(library, cell.accountId, png(1300)),
      ];
      const note = await noteItem(cell);
      // two of the agent's turns, each a set of its own: the second's before names the old cover
      for (const cover of [old, fresh]) {
        const turn = openTurn(cell);
        setCover(cell, turn.actor, note, cover);
        turn.end();
      }
      clock.now += 6 * DAY;
      await runJobs(cell);
      expect(fileRows(cell, old)).toBe(1);
      // the prune drops the set, and the same run lets go the file it alone named
      clock.now += 2 * DAY;
      await runJobs(cell);
      expect(fileRows(cell, old)).toBe(0);
      expect(fileRows(cell, fresh)).toBe(1);
      await expect(inR2(cell, old)).resolves.toBe(false);
    });
  });
});

// what R2 holds of an upload
const stored = (bytes: number) => ({ bytes, mime: "image/png" });

const strayJobs = (state: DurableObjectState) =>
  state.storage.sql
    .exec("SELECT id, attempts FROM jobs WHERE kind = 'stray' ORDER BY id")
    .toArray();

describe("an upload's room", () => {
  it("is held against the cap, and let go when nothing landed", async () => {
    await inCell(cellOf(), (state) => {
      const bytesCap = state.storage.sql.databaseSize + 1000;
      const { library } = cellIn(state, { bytesCap, clock: clockAt() });
      const sha = "b".repeat(64);
      expect(refusalOf(reserve(library, { ...stored(5000), sha }))).toMatchObject({
        bytesCap,
        kind: "quota",
      });
      landedValue(reserve(library, { ...stored(500), sha }));
      expect(refusalOf(reserve(library, { ...stored(600), sha: "c".repeat(64) }))).toMatchObject({
        kind: "quota",
      });
      expect(landedValue(settle(library, sha, null, removalsOf(library)))).toBe("absent");
      landedValue(reserve(library, { ...stored(600), sha: "c".repeat(64) }));
    });
  });

  it("goes when its upload is refused, whose bytes leave R2, and the sha lands only once they are out", async () => {
    await inCell(cellOf(), async (state) => {
      const bytesCap = state.storage.sql.databaseSize + 100_000;
      const cell = cellIn(state, { bytesCap, clock: clockAt() });
      const { library } = cell;
      const sha = "e".repeat(64);
      landedValue(reserve(library, { ...stored(500), sha }));
      expect(refusalOf(settle(library, sha, stored(200_000), removalsOf(library)))).toMatchObject({
        kind: "quota",
      });
      expect(state.storage.sql.exec("SELECT * FROM blob_uploads").toArray()).toStrictEqual([]);
      // what R2 showed may be the refused bytes, or gone under the removal: nothing lands
      expect(landedValue(settle(library, sha, stored(500), removalsOf(library)))).toBe("removing");
      const before = removalsOf(library);
      await runKind(cell, "stray");
      expect(strayJobs(state)).toStrictEqual([]);
      // a settle that looked in R2 before the removal ended lands nothing; one after it lands
      expect(landedValue(settle(library, sha, stored(500), before))).toBe("stale");
      expect(landedValue(settle(library, sha, stored(500), removalsOf(library)))).toBe("held");
    });
  });

  it("leaves nothing in R2 once it is let go unused, unless the sha is held again", async () => {
    await inCell(cellOf(), async (state) => {
      const clock = clockAt();
      const cell = cellIn(state, { clock });
      const { library } = cell;
      const [kept, retried] = ["f".repeat(64), "0".repeat(64)];
      for (const sha of [kept, retried]) {
        landedValue(reserve(library, { ...stored(10), sha }));
      }
      clock.now += 60 * 60_000;
      await runKind(cell, "upload");
      expect(strayJobs(state)).toStrictEqual([
        { attempts: 0, id: `stray:${retried}` },
        { attempts: 0, id: `stray:${kept}` },
      ]);
      // a device asks for room again for one: its removal is called off
      landedValue(reserve(library, { ...stored(10), sha: kept }));
      // R2 fails the other: it keeps its lease to wait its turn again, and the count of removals
      // stays
      const count = removalsOf(library);
      const r2 = vi.spyOn(env.BLOBS, "delete").mockRejectedValueOnce(new Error("R2 is down"));
      await runKind(cell, "stray");
      expect(r2).toHaveBeenCalledExactlyOnceWith([blobKey(cell.accountId, retried)]);
      r2.mockRestore();
      expect(strayJobs(state)).toStrictEqual([{ attempts: 1, id: `stray:${retried}` }]);
      expect(removalsOf(library)).toBe(count);
    });
  });

  it("calls off a removal R2 failed once it holds the sha again, and its settle looks again", async () => {
    await inCell(cellOf(), async (state) => {
      const clock = clockAt();
      const cell = cellIn(state, { clock });
      const { library } = cell;
      const sha = "1".repeat(64);
      landedValue(reserve(library, { ...stored(500), sha }));
      clock.now += 60 * 60_000;
      await runKind(cell, "upload");
      const before = removalsOf(library);
      // a device asks for room while R2 is asked, and R2 fails the removal
      const r2 = vi.spyOn(env.BLOBS, "delete").mockImplementationOnce(async () => {
        landedValue(reserve(library, { ...stored(500), sha }));
        await Promise.reject(new Error("R2 is down"));
      });
      await runKind(cell, "stray");
      r2.mockRestore();
      expect(strayJobs(state)).toStrictEqual([]);
      // a removal that failed may have removed, so what a settle read of R2 under it is read again
      expect(landedValue(settle(library, sha, stored(500), before))).toBe("stale");
      expect(landedValue(settle(library, sha, stored(500), removalsOf(library)))).toBe("held");
    });
  });
});

describe("a file settled while a removal runs", () => {
  it("lands on a second look in R2 when the removal that ended under the first was another file's", async () => {
    await inLibrary(async (cell) => {
      const { accountId, clock, library } = cell;
      // room nobody used is a stray an hour on, its removal due
      const stray = "9".repeat(64);
      landedValue(reserve(library, { bytes: 10, mime: "image/png", sha: stray }));
      clock.now += 60 * 60_000;
      await runKind(cell, "upload");
      const sha = "a".repeat(64);
      landedValue(reserve(library, { bytes: 5, mime: "image/png", sha }));
      await env.BLOBS.put(blobKey(accountId, sha), "bytes", {
        httpMetadata: { contentType: "image/png" },
      });
      // R2 is being read when the stray's removal ends
      const settling = settleStored(env, accountId, library, sha);
      landedValue(
        library.rows((db) => {
          endRemoval(db, stray);
        }),
      );
      await expect(settling).resolves.toStrictEqual({ ok: true, value: "held" });
    });
  });
});
