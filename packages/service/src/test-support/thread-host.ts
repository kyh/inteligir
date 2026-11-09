// A conversation's loop stepped by hand (`../agent/thread-loop`), over the object's own storage,
// its real cell and the scripted Messages API, with the jobs it asks for kept in place of
// Lifecycle's queue: a retry it times for later, an approval's ten minutes, are each run at once
// by the suite, so what a deployed thread waits seconds or minutes for is a step away. The cell
// holds the thread and its open turn as a send leaves them; the delivery is the one the cell would
// hand over, the library's filing rules with it, and the next turn is handed over the same way once
// the last has sealed. A suite may
// stand in for the deployment's definition, to swap it between steps as a deploy would, and reads
// every request body the loop sent.

import { runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { z } from "zod";

import type { AgentThreadDO } from "../agent/agent-thread";
import { anthropicClient } from "../agent/anthropic-client";
import { acceptDelivery, listeningFetch, rulesHashOf, step } from "../agent/thread-loop";
import type { CallInFlight, StepResult, ThreadCell, ThreadHost } from "../agent/thread-loop";
import { deployedDefinition } from "../agent/thread-request";
import type { ThreadDefinition } from "../agent/thread-request";
import { openThreadSchema } from "../agent/thread-schema";
import { turnUserMessage } from "../agent/turn-message";
import { bookTurn, dayOf } from "../agent/agent-allowance";
import { createThread, insertTurn, setThreadStatus } from "../agent/turn-rows";
import { openCellLibrary } from "../library/cell-library";
import { cellStorageOf } from "../library/cell-storage";
import { libraryCellName } from "../library/library-cell";
import { filingRules } from "../library/library-rules";
import type { AgentAccount } from "./agent-turns";
import { threadOf, valueOf } from "./agent-turns";
import { cellOf, inCell } from "./library-cell";

// what the loop asked of Lifecycle's queue, kept for the suite to run
interface AskedJobs {
  readonly drives: number[];
  readonly approvals: Map<string, number>;
  readonly outbox: number[];
}

export interface SteppedThread {
  readonly host: ThreadHost;
  readonly asked: AskedJobs;
  // every request body the loop sent, in order
  readonly sent: readonly string[];
  // the loop stepped until it rests, waits on the person, or times a retry, every step's result,
  // or `most` steps
  readonly run: (most?: number) => Promise<StepResult[]>;
  // the person's next message, opened as a turn in the cell and handed to the thread: its number
  readonly deliver: (text: string) => Promise<number>;
}

// a send's open turn in the cell, as an admission leaves it, its thread new for the first: the
// filing rules a delivery of it carries
export const openTurnInCell = async (
  account: AgentAccount,
  threadId: string,
  text: string,
  turn = 1,
): Promise<string | null> =>
  await inCell(account.cell, (state) => {
    const library = openCellLibrary(state, env);
    return valueOf(
      library.landApart({ answer: z.string().nullable(), opId: undefined }, (scope) => {
        if (turn === 1) {
          createThread(scope, threadId, text);
        }
        insertTurn(scope.storage, {
          at: scope.now,
          message: { text, viewContext: null },
          threadId,
          turn,
        });
        bookTurn(scope.storage, dayOf(scope.now), 1);
        setThreadStatus(scope, threadId, "running");
        return filingRules(scope.storage);
      }),
    );
  });

const turnSchema = z.object({ turn: z.number() });

// the thread's loop inside its own object, the turn the cell holds open handed in as delivered;
// `cell` stands in for the cell's answers where the suite needs one to fail, and `definition` for
// the deployment's
export const inSteppedThread = async <T>(
  account: AgentAccount,
  threadId: string,
  text: string,
  work: (thread: SteppedThread) => Promise<T>,
  options: {
    readonly cell?: (real: ThreadCell) => ThreadCell;
    readonly definition?: () => ThreadDefinition;
  } = {},
): Promise<T> => {
  const rules = await openTurnInCell(account, threadId, text);
  const real = (): ThreadCell => exports.LibraryDO.getByName(libraryCellName(account.accountId));
  return await runInDurableObject(
    threadOf(account.accountId, threadId),
    async (_thread: AgentThreadDO, state) => {
      const sql = cellStorageOf(state.storage);
      openThreadSchema(sql);
      const asked: AskedJobs = { approvals: new Map(), drives: [], outbox: [] };
      const calls = new Map<number, CallInFlight>();
      const sent: string[] = [];
      const listening = listeningFetch(calls, Date.now);
      const host: ThreadHost = {
        calls,
        cell: () => options.cell?.(real()) ?? real(),
        client: () =>
          anthropicClient(env, async (input, init) => {
            const request = new Request(input, init);
            sent.push(await request.clone().text());
            return await listening(request);
          }),
        definition: options.definition ?? deployedDefinition,
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
      const handOver = async (turn: {
        readonly text: string;
        readonly turn: number;
        readonly rules: string | null;
      }) => {
        const content = turnUserMessage({ text: turn.text, viewContext: null });
        acceptDelivery(
          host,
          {
            content,
            opId: `${threadId}:${String(turn.turn)}`,
            rules: turn.rules,
            threadId,
            turn: turn.turn,
          },
          await rulesHashOf(turn.rules),
        );
      };
      await handOver({ rules, text, turn: 1 });
      const deliver = async (next: string): Promise<number> => {
        const [last] = sql.all("SELECT max(turn) AS turn FROM turns", []);
        const turn = turnSchema.parse(last).turn + 1;
        // a stub made here, inside the thread's object, which may not use one made outside it
        const held = await openTurnInCell(
          { ...account, cell: cellOf(account.accountId) },
          threadId,
          next,
          turn,
        );
        await handOver({ rules: held, text: next, turn });
        return turn;
      };
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
      return await work({ asked, deliver, host, run, sent });
    },
  );
};
