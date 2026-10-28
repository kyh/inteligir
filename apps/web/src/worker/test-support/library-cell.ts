// A library cell under test: a fresh one per test, the engine opened inside it over its own
// storage with a clock the test moves, and items built by hand. The cell is the real Durable
// Object, so every statement meets a SQLite Durable Object's own limits.

import { ordsBetween } from "@repo/notes/library/block-order";
import type { LibraryItemFields } from "@repo/notes/library/library-item";
import type { LibraryBlock, LibrarySection } from "@repo/notes/library/library-nodes";
import { runInDurableObject } from "cloudflare:test";
import { exports } from "cloudflare:workers";

import type { CellActor } from "../library/cell-actor";
import type { CellResult } from "../library/cell-refusal";
import { cellStorageOf } from "../library/cell-storage";
import { libraryCellName } from "../library/library-cell";
import type { LibraryDO } from "../library/library-do";
import { openLibraryEngine } from "../library/library-engine";
import type { LibraryEngine } from "../library/library-engine";

export { blockHash as hashOf } from "@repo/notes/library/block-hash";

const GiB = 1024 * 1024 * 1024;

export const newAccountId = (): string => crypto.randomUUID();

export const cellOf = (accountId: string = newAccountId()): DurableObjectStub<LibraryDO> =>
  exports.LibraryDO.getByName(libraryCellName(accountId));

// the time the engine reads, which a test moves by hand
export interface Clock {
  now: number;
}

export const clockAt = (now: number = Date.UTC(2026, 9, 1)): Clock => ({ now });

export const engineIn = (state: DurableObjectState, clock: Clock, bytesCap = GiB): LibraryEngine =>
  openLibraryEngine({
    bytesCap,
    newId: () => crypto.randomUUID(),
    now: () => clock.now,
    storage: cellStorageOf(state.storage),
  });

// the engine inside a fresh cell, its result handed back out
export const inCell = async <T>(
  stub: DurableObjectStub<LibraryDO>,
  run: (state: DurableObjectState, cell: LibraryDO) => T | Promise<T>,
): Promise<T> =>
  await runInDurableObject(stub, async (cell: LibraryDO, state) => await run(state, cell));

export const person = (deviceId = "laptop"): CellActor => ({
  deviceId,
  kind: "person",
  label: `You on ${deviceId}`,
});

export const SYSTEM: CellActor = { kind: "system", label: "Library" };

export const noteFields = (overrides: Partial<LibraryItemFields> = {}): LibraryItemFields => ({
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
  originalName: null,
  originalSha: null,
  pinnedAt: null,
  properties: {},
  published: null,
  savedAt: Date.UTC(2026, 8, 1),
  site: null,
  tags: [],
  title: "A note",
  url: null,
  ...overrides,
});

export const paragraph = (id: string, text: string): LibraryBlock => ({
  children: [{ text }],
  id,
  type: "p",
});

// blocks in the order given, keyed as the library mints keys
export const placed = (
  blocks: readonly LibraryBlock[],
  section: LibrarySection = "note",
): { block: LibraryBlock; ord: string; section: LibrarySection }[] => {
  const keys = ordsBetween(null, null, blocks.length);
  return blocks.map((block, index) => ({ block, ord: keys[index] ?? "a0", section }));
};

// the value of a result the test expects to land
export const landedValue = <T>(result: CellResult<T>): T => {
  if (!result.ok) {
    throw new Error(`the cell refused: ${JSON.stringify(result.refusal)}`);
  }
  return result.value;
};

export const refusalOf = <T>(result: CellResult<T>) => {
  if (result.ok) {
    throw new Error(
      `the cell landed what the test expected it to refuse: ${JSON.stringify(result.value)}`,
    );
  }
  return result.refusal;
};
