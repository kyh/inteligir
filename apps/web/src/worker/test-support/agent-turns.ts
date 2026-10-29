// The built-in agent turned on in a cell under test, over the fake Managed Agents API: the fake,
// the cell as the agent's turns see it, what its sockets were told, and a wait for every turn to
// come to rest, the fake's runners and the work the cell stays up for alike.

import type { LibrarySocketFrame } from "@repo/contract/cloud/library/library-socket";
import type { FakeManagedAgents } from "@repo/managed-agents-fake/fake-api";
import { env } from "cloudflare:workers";
import { z } from "zod";

import type { AgentCell } from "../agent/agent-access";
import { turnAgentOn } from "../agent/agent-access";
import type { Allowance } from "../agent/agent-allowance";
import type { ManagedAgents } from "../agent/managed-agents";
import { createThread, openTurn, setTurnRunning, setTurnSession } from "../agent/turn-rows";
import { claimTurn } from "../agent/turn-state";
import { openCellLibrary } from "../library/cell-library";
import type { LibraryEngine } from "../library/library-engine";
import type { CellResult } from "../library/cell-refusal";
import { agentCellIn } from "./library-cell";
import type { Clock } from "./library-cell";
import { fakeManagedAgentsApi, managedAgentsOver } from "./managed-agents-api";

export interface AgentUnderTest {
  readonly api: FakeManagedAgents;
  readonly cell: AgentCell;
  readonly frames: LibrarySocketFrame[];
  // every turn at rest: the fake's waiting on nothing but the person, and the cell's streams read
  readonly settled: () => Promise<void>;
}

export const valueOf = <T>(result: CellResult<T>): T => {
  if (!result.ok) {
    throw new Error(`the cell refused: ${result.refusal.kind}`);
  }
  return result.value;
};

export const agentOn = async (
  state: DurableObjectState,
  options: {
    readonly allowance?: Allowance;
    readonly api?: FakeManagedAgents;
    readonly agents?: ManagedAgents;
    readonly clock?: Clock;
  } = {},
): Promise<AgentUnderTest> => {
  const api = options.api ?? fakeManagedAgentsApi();
  const background: Promise<void>[] = [];
  const frames: LibrarySocketFrame[] = [];
  const cell = agentCellIn(state, openCellLibrary(state, env), {
    agents: options.agents ?? managedAgentsOver(api),
    background,
    clock: options.clock,
    env: options.allowance === undefined ? env : { ...env, AGENT_ALLOWANCE: options.allowance },
    frames,
  });
  valueOf(await turnAgentOn(cell));
  const settled = async (): Promise<void> => {
    for (let round = 0; round < 50; round += 1) {
      await api.settled();
      const pending = background.splice(0);
      if (pending.length === 0) {
        return;
      }
      await Promise.all(pending);
    }
    throw new Error("the agent's turns never came to rest");
  };
  return { api, cell, frames, settled };
};

// a turn of the account's open and running, as a send leaves one once its session took the
// message, so the built-in client's calls are taken; one already open is left as it is
export const holdTurnOpen = (library: LibraryEngine): void => {
  valueOf(
    library.landApart({ answer: z.literal(true), opId: undefined }, (scope) => {
      if (openTurn(scope.storage) === null) {
        const threadId = library.ids.thread();
        createThread(scope, threadId, "A turn held open.");
        claimTurn(scope, { message: { text: "A turn held open.", viewContext: null }, threadId });
        setTurnSession(scope.storage, "sesn_held_open");
        setTurnRunning(scope.storage);
      }
      return true as const;
    }),
  );
};

const rowSchema = z.object({ type: z.string() });

// the event types a thread stored, in order
export const storedTypes = (state: DurableObjectState, threadId: string): string[] =>
  state.storage.sql
    .exec("SELECT type FROM thread_events WHERE thread_id = ? ORDER BY idx", threadId)
    .toArray()
    .map((row) => rowSchema.parse(row).type);

const statusSchema = z.object({ status: z.string() });

export const threadStatus = (state: DurableObjectState, threadId: string): string | null => {
  const [row] = state.storage.sql
    .exec("SELECT status FROM threads WHERE id = ?", threadId)
    .toArray();
  return row === undefined ? null : statusSchema.parse(row).status;
};

export const turnOpen = (state: DurableObjectState): boolean =>
  state.storage.sql.exec("SELECT 1 FROM agent_turn").toArray().length > 0;
