// The built-in agent under test, end to end: an account's real cell and its conversations' real
// objects, each thread running its loop against the scripted Messages API the suites' outbound
// service answers (packages/service/messages-service.ts), so every call a turn makes is the one it
// makes deployed. A suite sends as the account's laptop would, inside the cell, then waits from
// outside it for the turn to come to rest, since the thread's own calls back into the cell are what
// move the turn.

import type { FakeStats } from "@repo/messages-fake/messages-fake";
import { createRouterClient } from "@orpc/server";
import { runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { vi } from "vitest";
import { z } from "zod";

import type { AgentThreadDO } from "../agent/agent-thread";
import { threadStub } from "../agent/thread-stub";
import type { LibrarySocketFrame } from "@repo/contract/library/library-socket";
import { openCellLibrary } from "../library/cell-library";
import type { CellResult } from "../library/cell-refusal";
import type { LibraryDO } from "../library/library-do";
import { cellActorOf } from "../library/library-principal";
import { libraryRouter } from "../library/library-router";
import { agentCellIn, cellOf, inCell, newAccountId, notesIn } from "./library-cell";

export const valueOf = <T>(result: CellResult<T>): T => {
  if (!result.ok) {
    throw new Error(`the cell refused: ${result.refusal.kind}`);
  }
  return result.value;
};

export interface AgentAccount {
  readonly accountId: string;
  readonly cell: DurableObjectStub<LibraryDO>;
}

export const agentAccount = (): AgentAccount => {
  const accountId = newAccountId();
  return { accountId, cell: cellOf(accountId) };
};

export type LaptopClient = ReturnType<typeof laptopClient>;

const laptopClient = (
  state: DurableObjectState,
  options: { readonly env?: Env; readonly frames?: LibrarySocketFrame[] },
) => {
  const library = openCellLibrary(state, options.env ?? env);
  const agent = agentCellIn(state, library, options);
  const actor = cellActorOf({
    accountId: agent.accountId,
    actor: { door: "page", kind: "session", sessionId: "laptop-1" },
  });
  return createRouterClient(libraryRouter, {
    context: { actor: () => actor, agent, library, notes: notesIn(state), settle: agent.settle },
  });
};

// the account's library as its laptop calls it, inside its cell; `env` stands in for the
// deployment's bindings the call reads, and `frames` hears what the call tells the sockets
export const asLaptop = async <T>(
  account: AgentAccount,
  run: (client: LaptopClient, state: DurableObjectState) => Promise<T>,
  options: { readonly env?: Env; readonly frames?: LibrarySocketFrame[] } = {},
): Promise<T> =>
  await inCell(account.cell, async (state) => await run(laptopClient(state, options), state));

// the person's words and a script's directive lines (tools/messages-fake/README.md), opened by a
// line of its own, so no two tests' requests are the same bytes to the fake's per-body counters
export const script = (...lines: readonly string[]): string =>
  [`Run ${crypto.randomUUID()}.`, ...lines].join("\n");

export const threadOf = (accountId: string, threadId: string): DurableObjectStub<AgentThreadDO> =>
  threadStub(exports, accountId, threadId);

const countSchema = z.object({ count: z.number() });

// whether a conversation's object holds its tables, read without starting its lifecycle: a purge
// takes them with every row, and only a fresh instance's constructor makes them again
export const threadHolds = async (accountId: string, threadId: string): Promise<boolean> =>
  await runInDurableObject(threadOf(accountId, threadId), (_thread: AgentThreadDO, state) => {
    const [tables] = state.storage.sql
      .exec("SELECT count(*) AS count FROM sqlite_master WHERE name = '__drizzle_migrations'")
      .toArray();
    return countSchema.parse(tables).count > 0;
  });

// rows of a conversation's object, read without starting it
export const threadRows = async (
  accountId: string,
  threadId: string,
  query: string,
  ...params: readonly SqlStorageValue[]
): Promise<Record<string, SqlStorageValue>[]> =>
  await runInDurableObject(threadOf(accountId, threadId), (_thread: AgentThreadDO, state) =>
    state.storage.sql.exec(query, ...params).toArray(),
  );

// rows of the account's cell
export const cellRows = async (
  account: AgentAccount,
  query: string,
  ...params: readonly SqlStorageValue[]
): Promise<Record<string, SqlStorageValue>[]> =>
  await inCell(account.cell, (state) => state.storage.sql.exec(query, ...params).toArray());

const statusSchema = z.object({ status: z.string() });

// the thread's status as every device reads it
export const threadStatus = async (
  account: AgentAccount,
  threadId: string,
): Promise<string | null> => {
  const [row] = await cellRows(account, "SELECT status FROM threads WHERE id = ?", threadId);
  return row === undefined ? null : statusSchema.parse(row).status;
};

// a turn's end can take a few model calls and tool calls, each a round trip through the fake
const SETTLE_MS = 20_000;

// the thread's turns all ended and sealed, its waiting sends with them, and its object's outbox
// empty: the cell holds no open turn of it and its status is idle
export const settled = async (
  account: AgentAccount,
  threadId: string,
  timeout = SETTLE_MS,
): Promise<void> => {
  await vi.waitFor(
    async () => {
      const open = await cellRows(
        account,
        "SELECT 1 FROM agent_turns WHERE thread_id = ?",
        threadId,
      );
      const status = await threadStatus(account, threadId);
      const inspection = await threadOf(account.accountId, threadId).inspect();
      if (open.length > 0 || status !== "idle" || inspection.outbox > 0) {
        throw new Error(`the thread is ${status ?? "gone"}, ${String(open.length)} turn open`);
      }
    },
    { interval: 50, timeout },
  );
};

const statsSchema = z.object({ drops: z.number(), held: z.number(), requests: z.number() });

// the fake's counters: the requests it answered, the replies a stall held open, and the replayed
// thinking blocks it dropped
export const fakeStats = async (): Promise<FakeStats> => {
  const response = await fetch(new URL("/__fake/stats", env.ANTHROPIC_FAKE_URL));
  return statsSchema.parse(await response.json());
};

// how many replies the fake has held open so far, read before a test sends what stalls
export const heldSoFar = async (): Promise<number> => {
  const { held } = await fakeStats();
  return held;
};

// the fake holding, mid-reply, one stalled call of each thread more than it had held `before`,
// each thread's call still streaming: what a cut or a stop then meets is a reply half sent. A
// call's row is written streaming before its request leaves, and a script's earlier steps stream
// too, so neither alone says the fake holds the stall
export const heldMidReply = async (
  account: AgentAccount,
  threadIds: readonly string[],
  before: number,
): Promise<void> => {
  await vi.waitFor(
    async () => {
      const { held } = await fakeStats();
      if (held !== before + threadIds.length) {
        throw new Error("the fake holds no stalled reply of every thread yet");
      }
      for (const threadId of threadIds) {
        const streaming = await threadRows(
          account.accountId,
          threadId,
          "SELECT 1 FROM model_calls WHERE status = 'streaming'",
        );
        if (streaming.length === 0) {
          throw new Error(`thread ${threadId} streams no call`);
        }
      }
    },
    { interval: 50, timeout: 10_000 },
  );
};

const typeRowSchema = z.object({ type: z.string() });

// the event types a thread stored, in order
export const storedTypes = async (account: AgentAccount, threadId: string): Promise<string[]> => {
  const rows = await cellRows(
    account,
    "SELECT type FROM thread_events WHERE thread_id = ? ORDER BY idx",
    threadId,
  );
  return rows.map((row) => typeRowSchema.parse(row).type);
};
