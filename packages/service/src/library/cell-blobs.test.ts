// A file past the item that named it, driven through the verbs a device calls, the cell's own
// write of a cover and the alarm's jobs: it stays while an item or any change set names it, and
// once nothing does it leaves the library, the quota and R2.

import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { pngOf } from "../fill/test-support/fill-cell";
import {
  cellIn,
  cellOf,
  clockAt,
  inCell,
  landedValue,
  openTurn,
  PERSON,
} from "../test-support/library-cell";
import type { Clock } from "../test-support/library-cell";
import { uploadedFile, zipOf } from "../test-support/library-files";
import type { CellActor } from "./cell-actor";
import { blobKey } from "./cell-blobs";
import { runImports } from "./cell-imports";
import { removeStrays } from "./cell-library";

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

const setCover = (
  { library }: Cell,
  actor: CellActor,
  itemId: string,
  base: string | null,
  value: string,
): void => {
  landedValue(
    library.write(actor, { itemId, ops: [{ base, field: "coverSha", op: "set", value }] }),
  );
};

const purge = async ({ client }: Cell, itemId: string): Promise<void> => {
  await client.items.delete({ ids: [itemId] });
  await client.items.purge({ ids: [itemId] });
};

// the alarm's turn at what waits on a file
const runAlarm = async ({ accountId, library }: Cell): Promise<void> => {
  library.runDueJobs(() => {});
  await removeStrays(env, accountId, library);
};

const fileRows = ({ state }: Cell, sha: string): number =>
  state.storage.sql.exec("SELECT 1 FROM blobs WHERE sha256 = ?", sha).toArray().length;

const bytesUsed = ({ state }: Cell): number => {
  const [row] = state.storage.sql.exec("SELECT v FROM meta WHERE k = 'bytes_used'").toArray();
  return Number(row?.v ?? 0);
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
      await runAlarm(cell);
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
      await runAlarm(cell);
      expect(fileRows(cell, sha)).toBe(1);
      await expect(inR2(cell, sha)).resolves.toBe(true);
      await purge(cell, second);
      await runAlarm(cell);
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
      setCover(cell, PERSON, note, null, old);
      // the agent's turn replaces it, so its set keeps the cover it found
      const turn = openTurn(cell);
      setCover(cell, turn.actor, note, old, fresh);
      turn.end();
      await purge(cell, fileHolder);
      await runAlarm(cell);
      expect(fileRows(cell, old)).toBe(1);
      await expect(inR2(cell, old)).resolves.toBe(true);
      // the note's change set alone names the old cover, and that goes with the note
      await purge(cell, note);
      await runAlarm(cell);
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
      setCover(cell, PERSON, note, null, first);
      setCover(cell, PERSON, note, first, second);
      await runAlarm(cell);
      expect(fileRows(cell, first)).toBe(1);
      cell.clock.now += DAY;
      await runAlarm(cell);
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
      for (const [base, value] of [
        [null, old],
        [old, fresh],
      ] as const) {
        const turn = openTurn(cell);
        setCover(cell, turn.actor, note, base, value);
        turn.end();
      }
      clock.now += 6 * DAY;
      await runAlarm(cell);
      expect(fileRows(cell, old)).toBe(1);
      clock.now += 2 * DAY;
      await runAlarm(cell);
      expect(fileRows(cell, old)).toBe(1);
      await runAlarm(cell);
      expect(fileRows(cell, old)).toBe(0);
      expect(fileRows(cell, fresh)).toBe(1);
      await expect(inR2(cell, old)).resolves.toBe(false);
    });
  });

  it("waits for an import's end, whose plan may name it", async () => {
    await inLibrary(async (cell) => {
      const { accountId, client, clock, library } = cell;
      const sha = await uploadedFile(library, accountId, png(1200));
      const itemId = await fileItem(cell, sha);
      const zip = await uploadedFile(library, accountId, {
        bytes: await zipOf({ "Note.md": new TextEncoder().encode("A note.\n") }),
        mime: "application/zip",
      });
      const { job } = await client.imports.start({ sha: zip, source: "markdown" });
      await purge(cell, itemId);
      await runAlarm(cell);
      expect(fileRows(cell, sha)).toBe(1);
      await client.imports.cancel({ id: job.id });
      await runImports(cell);
      clock.now += DAY;
      await runAlarm(cell);
      expect(fileRows(cell, sha)).toBe(0);
    });
  });
});
