// A file past the item that named it, driven through the verbs a device calls and the alarm's jobs:
// it stays while an item or any change set names it, and once nothing does it leaves the library,
// the quota and R2.

import type { LibraryBlock } from "@repo/notes/library/library-nodes";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { libraryIn, pngOf } from "../fill/test-support/fill-cell";
import {
  cellOf,
  clockAt,
  engineIn,
  hashOf,
  inCell,
  landedValue,
  newAccountId,
} from "../test-support/library-cell";
import type { Clock } from "../test-support/library-cell";
import { jobHostIn, uploadedFile, zipOf } from "../test-support/library-files";
import { blobKey } from "./cell-blobs";
import { EXPORT_LIMITS, runExports } from "./cell-exports";
import { FILL_ACTOR } from "./cell-fills";
import { runImports } from "./cell-imports";
import { removeStrays } from "./cell-library";
import type { LibraryEngine } from "./library-engine";

const DAY = 24 * 60 * 60_000;

const png = (width: number) => ({ bytes: pngOf(width, 600), mime: "image/png" });

interface Cell {
  readonly accountId: string;
  readonly client: ReturnType<typeof libraryIn>;
  readonly clock: Clock;
  readonly library: LibraryEngine;
  readonly state: DurableObjectState;
}

const inLibrary = async <T>(run: (cell: Cell) => Promise<T>): Promise<T> => {
  const accountId = newAccountId();
  return await inCell(cellOf(accountId), async (state) => {
    const clock = clockAt(Date.now());
    const library = engineIn(state, clock);
    return await run({
      accountId,
      client: libraryIn(state, accountId, library),
      clock,
      library,
      state,
    });
  });
};

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

const setCover = async ({ client }: Cell, itemId: string, base: string | null, value: string) => {
  await client.write({ itemId, ops: [{ base, field: "coverSha", op: "set", value }] });
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
      await setCover(cell, note, null, old);
      // sealed, so the next write's set keeps the cover it replaces
      cell.clock.now += 120_000;
      cell.library.runDueJobs(() => {});
      await setCover(cell, note, old, fresh);
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

  it("holds a file an embedded block's kept version names as a change set does", async () => {
    await inLibrary(async (cell) => {
      const sha = await uploadedFile(cell.library, cell.accountId, png(1200));
      const fileHolder = await fileItem(cell, sha);
      const note = await noteItem(cell);
      const block = {
        children: [{ text: "" }],
        id: "pic",
        sha,
        type: "img",
      } satisfies LibraryBlock;
      await cell.client.write({
        itemId: note,
        ops: [{ block, op: "insert", ord: "a0", section: "note" }],
      });
      cell.clock.now += 120_000;
      cell.library.runDueJobs(() => {});
      await cell.client.write({
        itemId: note,
        ops: [{ baseHash: hashOf(block), blockId: "pic", op: "drop" }],
      });
      await purge(cell, fileHolder);
      await runAlarm(cell);
      expect(fileRows(cell, sha)).toBe(1);
      await purge(cell, note);
      await runAlarm(cell);
      expect(fileRows(cell, sha)).toBe(0);
    });
  });

  it("waits out a day once a write replaced it within one change, which no change set kept", async () => {
    await inLibrary(async (cell) => {
      const [first, second] = [
        await uploadedFile(cell.library, cell.accountId, png(1200)),
        await uploadedFile(cell.library, cell.accountId, png(1300)),
      ];
      const note = await noteItem(cell);
      await setCover(cell, note, null, first);
      await setCover(cell, note, first, second);
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
      const write = (ops: Parameters<LibraryEngine["write"]>[1]["ops"]) =>
        landedValue(library.write(FILL_ACTOR, { itemId: note, ops }));
      // a reading's writes, each a set of its own: the second's before names the old cover
      write([{ base: null, field: "coverSha", op: "set", value: old }]);
      write([{ base: old, field: "coverSha", op: "set", value: fresh }]);
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
      const { accountId, client, clock, library, state } = cell;
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
      await runImports(jobHostIn(state, accountId, library, () => clock.now));
      clock.now += DAY;
      await runAlarm(cell);
      expect(fileRows(cell, sha)).toBe(0);
    });
  });

  it("waits for an export's end, whose zip may hold it", async () => {
    await inLibrary(async (cell) => {
      const { accountId, client, clock, library, state } = cell;
      const sha = await uploadedFile(library, accountId, png(1200));
      const itemId = await fileItem(cell, sha);
      const { export: started } = await client.exports.start({});
      const host = jobHostIn(state, accountId, library, () => clock.now);
      await runExports(host, EXPORT_LIMITS);
      await purge(cell, itemId);
      await runAlarm(cell);
      expect(fileRows(cell, sha)).toBe(1);
      for (let runs = 0; runs < 10; runs += 1) {
        clock.now += 60_000;
        await runExports(host, EXPORT_LIMITS);
      }
      const { export: written } = await client.exports.get({ id: started.id });
      expect(written.state).toBe("ready");
      clock.now += DAY;
      await runAlarm(cell);
      expect(fileRows(cell, sha)).toBe(0);
    });
  });
});
