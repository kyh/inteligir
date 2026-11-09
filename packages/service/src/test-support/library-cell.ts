// A library cell under test: a fresh one per test, the engine opened inside it over its own
// storage with a clock the test moves, and items built by hand. The cell is the real Durable
// Object, so every statement meets a SQLite Durable Object's own limits.

import type { LibrarySocketFrame } from "@repo/contract/library/library-socket";
import { ordsBetween } from "@repo/contract/library/block-order";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import type { LibraryBlock, LibrarySection } from "@repo/contract/library/library-nodes";
import { readBlocks, readItem } from "../library/library-queries";
import type { StoredItem } from "../library/library-queries";
import { runPlan } from "../library/library-sql";
import { runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";

import { runAgentTool } from "../agent/agent-tools";
import { turnActorOf } from "../agent/agent-turns";
import type { AgentCell } from "../agent/agent-turns";
import type { CellActor } from "../library/cell-actor";
import { cellIds } from "../library/cell-ids";
import { landNew } from "../library/cell-items";
import type { NewItem } from "../library/cell-items";
import { settleCommit } from "../library/cell-library";
import { tellSockets } from "../library/cell-sockets";
import type { CellResult } from "../library/cell-refusal";
import { cellStorageOf } from "../library/cell-storage";
import { cellAccountId, libraryCellName } from "../library/library-cell";
import type { LibraryDO } from "../library/library-do";
import { landedSchema, openLibraryEngine } from "../library/library-engine";
import type { LibraryEngine } from "../library/library-engine";
import { libraryRouter } from "../library/library-router";

export { blockHash as hashOf } from "@repo/contract/library/block-hash";

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
    ids: cellIds(() => clock.now),
    now: () => clock.now,
    storage: cellStorageOf(state.storage),
  });

// the built-in agent in a cell under test, as the cell makes it (`../library/library-do`): its
// conversations' objects reached through the cell's own `exports`, its sockets, which a test may
// listen on, every tool call run through the library's procedures as the turn's, and the commit's
// follow-up the cell's own. `env` stands in for the deployment's bindings, `clock` for its time
export const agentCellIn = (
  state: DurableObjectState,
  library: LibraryEngine,
  options: {
    readonly clock?: Clock;
    readonly env?: Env;
    readonly frames?: LibrarySocketFrame[];
  } = {},
): AgentCell => {
  const cellEnv = options.env ?? env;
  const settle = async <T>(result: CellResult<T>): Promise<CellResult<T>> =>
    await settleCommit(state, cellEnv, library, result);
  const cell: AgentCell = {
    accountId: cellAccountId(state.id.name),
    env: cellEnv,
    exports: state.exports,
    library,
    now: () => options.clock?.now ?? Date.now(),
    runTool: async (request) =>
      await runAgentTool(
        libraryRouter,
        { actor: turnActorOf(library, request), agent: cell, library, settle },
        request,
      ),
    settle,
    tell: (frame) => {
      options.frames?.push(frame);
      tellSockets(state, frame);
    },
  };
  return cell;
};

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

// a new item, landed as the library's own procedures land one
export const createItem = (
  library: LibraryEngine,
  actor: CellActor,
  input: NewItem & { readonly opId?: string },
) =>
  library.land(actor, { answer: landedSchema, opId: input.opId }, (scope) => ({
    item: landNew(scope, input),
  }));

export const noteFields = (overrides: Partial<LibraryItemFields> = {}): LibraryItemFields => ({
  aliases: [],
  author: null,
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

// an item's blocks as the cell holds them, in order
export const blocksOf = (library: LibraryEngine, itemId: string): LibraryBlock[] =>
  landedValue(library.read((sql) => runPlan(sql, readBlocks(itemId)))).map(
    (stored) => stored.block,
  );

// an item's row as the cell holds it, or null for none
export const storedItemOf = (library: LibraryEngine, itemId: string): StoredItem | null =>
  landedValue(library.read((sql) => runPlan(sql, readItem(itemId))));
