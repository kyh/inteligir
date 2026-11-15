// The account's cell as one wake holds it: one handle on its storage, the engine over it with the
// listing it keeps, each item's note, the built-in agent over the library's own procedures, and a
// call's context for whoever it is by. Its Durable Object opens it once a wake
// (`./library-do`), and a suite opens it the same way inside the cell, over the clock, the cap or
// the sockets it swaps, so no suite wires a cell the object does not.

import type { LibrarySocketFrame } from "@repo/contract/library/library-socket";

import { runAgentTool } from "../agent/agent-tools";
import { turnActorOf } from "../agent/agent-turns";
import type { AgentCell } from "../agent/agent-turns";
import { noteStub } from "../note/note-stub";
import type { NoteReach } from "../note/note-wire";
import type { CellActor } from "./cell-actor";
import { cellDbOf } from "./cell-db";
import type { CellDb } from "./cell-db";
import { cellIds } from "./cell-ids";
import type { ImportHost } from "./cell-import-host";
import { settleCommit } from "./cell-library";
import { tellSockets } from "./cell-sockets";
import { cellAccountId } from "./library-cell";
import { openLibraryEngine } from "./library-engine";
import type { LibraryEngine } from "./library-engine";
import { agentPrincipal, cellActorOf, isNamedPrincipal } from "./library-principal";
import type { Principal } from "./library-principal";
import { libraryRouter } from "./library-router";
import type { CellContext } from "./library-router";

const STORAGE_CAP = /^[1-9]\d*$/u;

// what one account's library may hold, its change sets included: 1 GiB
const libraryStorageCap = (env: Env): number => {
  const cap = env.LIBRARY_STORAGE_CAP_BYTES;
  if (!STORAGE_CAP.test(cap)) {
    throw new Error(`LIBRARY_STORAGE_CAP_BYTES must be a whole number of bytes, not "${cap}"`);
  }
  return Number(cap);
};

// what a suite stands in for: the platform's clock, the deployment's cap, and the sockets the
// agent's frames go to
interface CellPorts {
  readonly now?: (() => number) | undefined;
  readonly bytesCap?: number | undefined;
  readonly tell?: ((frame: LibrarySocketFrame) => void) | undefined;
}

// the cell as the agent's turns and an import's runs each need it, and what every door reads
export interface Cell extends AgentCell, ImportHost {
  readonly db: CellDb;
  // each item's note, which this cell alone names for the items its rows hold
  readonly notes: NoteReach;
  // a call's cell: whom its writes are by, and what follows its commit
  readonly contextFor: (principal: Principal) => CellContext;
}

// whom a call's writes are by: what its principal names, or for the built-in agent its turn,
// read again as each write lands, which a turn sealed meanwhile refuses
const actorOf = (library: LibraryEngine, principal: Principal): (() => CellActor) => {
  if (isNamedPrincipal(principal)) {
    const actor = cellActorOf(principal);
    return () => actor;
  }
  return turnActorOf(library, principal.actor);
};

export const openCell = (ctx: DurableObjectState, env: Env, ports: CellPorts = {}): Cell => {
  const accountId = cellAccountId(ctx.id.name);
  const now = ports.now ?? Date.now;
  const db = cellDbOf(ctx.storage);
  const library = openLibraryEngine({
    bytesCap: ports.bytesCap ?? libraryStorageCap(env),
    db,
    ids: cellIds(now),
    now,
  });
  const cell: Cell = {
    accountId,
    contextFor: (principal) => ({
      actor: actorOf(library, principal),
      agent: cell,
      library,
      notes: cell.notes,
      settle: cell.settle,
    }),
    db,
    durable: async () => {
      await ctx.storage.sync();
    },
    env,
    exports: ctx.exports,
    library,
    notes: (itemId) => noteStub(ctx.exports, { accountId, itemId }),
    now,
    // every tool call the agent runs is one of its turn's, through the library's procedures
    runTool: async (request) =>
      await runAgentTool(
        libraryRouter,
        cell.contextFor(agentPrincipal(accountId, request)),
        request,
      ),
    settle: async (result) => await settleCommit(ctx, env, library, result),
    tell:
      ports.tell ??
      ((frame) => {
        tellSockets(ctx, frame);
      }),
  };
  return cell;
};
