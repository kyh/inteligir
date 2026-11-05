// A conversation's loop stepped by hand (`../agent/thread-loop`), over the object's own storage,
// its real cell and the scripted Messages API, with the jobs it asks for kept in place of
// Lifecycle's queue: a retry it times for later, an approval's ten minutes, are each run at once
// by the suite, so what a deployed thread waits seconds or minutes for is a step away. The cell
// holds the thread and its open turn as a send leaves them; the delivery is the one the cell would
// hand over.

import { runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { z } from "zod";

import type { AgentThreadDO } from "../agent/agent-thread";
import { anthropicClient } from "../agent/anthropic-client";
import { acceptDelivery, rulesHashOf, step } from "../agent/thread-loop";
import type { StepResult, ThreadCell, ThreadHost } from "../agent/thread-loop";
import { openThreadSchema } from "../agent/thread-schema";
import { turnUserMessage } from "../agent/turn-message";
import { bookTurn, dayOf } from "../agent/agent-allowance";
import { createThread, insertTurn, setThreadStatus } from "../agent/turn-rows";
import { openCellLibrary } from "../library/cell-library";
import { cellStorageOf } from "../library/cell-storage";
import { libraryCellName } from "../library/library-cell";
import type { AgentAccount } from "./agent-turns";
import { threadOf, valueOf } from "./agent-turns";
import { inCell } from "./library-cell";

// what the loop asked of Lifecycle's queue, kept for the suite to run
interface AskedJobs {
  readonly drives: number[];
  readonly approvals: Map<string, number>;
  readonly outbox: number[];
}

export interface SteppedThread {
  readonly host: ThreadHost;
  readonly asked: AskedJobs;
  // the loop stepped until it rests, waits on the person, or times a retry, every step's result
  readonly run: (most?: number) => Promise<StepResult[]>;
}

// a send's open turn in the cell, as an admission leaves it, its thread new
export const openTurnInCell = async (
  account: AgentAccount,
  threadId: string,
  text: string,
): Promise<void> => {
  await inCell(account.cell, (state) => {
    const library = openCellLibrary(state, env);
    valueOf(
      library.landApart({ answer: z.null(), opId: undefined }, (scope) => {
        createThread(scope, threadId, text);
        insertTurn(scope.storage, {
          at: scope.now,
          message: { text, viewContext: null },
          threadId,
          turn: 1,
        });
        bookTurn(scope.storage, dayOf(scope.now), 1);
        setThreadStatus(scope, threadId, "running");
        return null;
      }),
    );
  });
};

// the thread's loop inside its own object, the turn the cell holds open handed in as delivered;
// `cell` stands in for the cell's answers where the suite needs one to fail
export const inSteppedThread = async <T>(
  account: AgentAccount,
  threadId: string,
  text: string,
  work: (thread: SteppedThread) => Promise<T>,
  options: { readonly cell?: (real: ThreadCell) => ThreadCell } = {},
): Promise<T> => {
  await openTurnInCell(account, threadId, text);
  const real = (): ThreadCell => exports.LibraryDO.getByName(libraryCellName(account.accountId));
  return await runInDurableObject(
    threadOf(account.accountId, threadId),
    async (_thread: AgentThreadDO, state) => {
      const sql = cellStorageOf(state.storage);
      openThreadSchema(sql);
      const asked: AskedJobs = { approvals: new Map(), drives: [], outbox: [] };
      const host: ThreadHost = {
        aborts: new Map(),
        cell: () => options.cell?.(real()) ?? real(),
        client: () => anthropicClient(env),
        isolate: crypto.randomUUID(),
        jobs: {
          approvalAt: async (toolUseId, at) => {
            asked.approvals.set(toolUseId, await Promise.resolve(at));
          },
          driveAt: async (at) => {
            asked.drives.push(await Promise.resolve(at));
          },
          dropApproval: async (toolUseId) => {
            asked.approvals.delete(await Promise.resolve(toolUseId));
          },
          outboxAt: async (at) => {
            asked.outbox.push(await Promise.resolve(at));
          },
        },
        now: Date.now,
        purge: async () => {
          await state.storage.deleteAll();
        },
        sql,
        threadId,
      };
      const content = turnUserMessage({ text, viewContext: null });
      acceptDelivery(
        host,
        { content, opId: `${threadId}:1`, rules: null, threadId, turn: 1 },
        await rulesHashOf(null),
      );
      const run = async (most = 40): Promise<StepResult[]> => {
        const results: StepResult[] = [];
        for (let at = 0; at < most; at += 1) {
          const result = await step(host);
          results.push(result);
          if (result !== "continue") {
            return results;
          }
        }
        return results;
      };
      return await work({ asked, host, run });
    },
  );
};
