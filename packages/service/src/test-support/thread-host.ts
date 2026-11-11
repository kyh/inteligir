// A conversation's loop stepped by hand (`../agent/thread-loop`), over the object's own storage,
// its real cell and the scripted Messages API, its drive moved as the object moves its own
// (`../agent/thread-drive`), with the jobs it asks for kept in place of Lifecycle's queue: a retry
// it times for later, an approval's ten minutes, are each run at once by the suite, so what a
// deployed thread waits seconds or minutes for is a step away; a purge cuts the call in flight and
// deletes what the thread keeps, as the object's does. The cell
// holds the thread and its open turn as a send leaves them; the delivery is the one the cell would
// hand over, the library's filing rules and the last push the cell landed of the thread with it,
// and the next turn is handed over the same way once the last has sealed. A suite may
// stand in for the deployment's definition, to swap it between steps as a deploy would, and reads
// every request body the loop sent.

import { threadTurns } from "@repo/db/thread/schema";
import { runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { max } from "drizzle-orm";
import { z } from "zod";

import type { AgentThreadDO } from "../agent/agent-thread";
import { anthropicClient } from "../agent/anthropic-client";
import { threadDbOf } from "../agent/thread-db";
import { cutCall, nextDrive, RESTING } from "../agent/thread-drive";
import type { Drive, DriveEffect, DriveEvent, StepResult } from "../agent/thread-drive";
import { acceptDelivery, listeningFetch, rulesHashOf, step } from "../agent/thread-loop";
import type { CallInFlight, ThreadCell, ThreadHost } from "../agent/thread-loop";
import { deployedDefinition } from "../agent/thread-request";
import type { ThreadDefinition } from "../agent/thread-request";
import { turnUserMessage } from "../agent/turn-message";
import { bookTurn, dayOf } from "../agent/agent-allowance";
import { createThread, insertTurn, lastPush, restatus } from "../agent/turn-rows";
import { openCellLibrary } from "../library/cell-library";
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

const handedSchema = z.object({ pushedThrough: z.number(), rules: z.string().nullable() });

// a send's open turn in the cell, as an admission leaves it, its thread new for the first: the
// filing rules a delivery of it carries, and the last push the cell landed of the thread
export const openTurnInCell = async (
  account: AgentAccount,
  threadId: string,
  text: string,
  turn = 1,
): Promise<z.infer<typeof handedSchema>> =>
  await inCell(account.cell, (state) => {
    const library = openCellLibrary(state, env);
    return valueOf(
      library.landApart({ answer: handedSchema, opId: undefined }, (scope) => {
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
        restatus(scope, threadId);
        return {
          pushedThrough: lastPush(scope.storage, threadId),
          rules: filingRules(scope.storage.db),
        };
      }),
    );
  });

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
  const first = await openTurnInCell(account, threadId, text);
  const real = (): ThreadCell => exports.LibraryDO.getByName(libraryCellName(account.accountId));
  return await runInDurableObject(
    threadOf(account.accountId, threadId),
    async (_thread: AgentThreadDO, state) => {
      const db = threadDbOf(state.storage);
      const asked: AskedJobs = { approvals: new Map(), drives: [], outbox: [] };
      const calls = new Map<number, CallInFlight>();
      const sent: string[] = [];
      const listening = listeningFetch(calls, Date.now);
      let drive: Drive = RESTING;
      const move = (event: DriveEvent): DriveEffect => {
        const { drive: after, effect } = nextDrive(drive, event);
        drive = after;
        return effect;
      };
      const host: ThreadHost = {
        calls,
        cell: () => options.cell?.(real()) ?? real(),
        db,
        client: () =>
          anthropicClient(env, account.accountId, async (input, init) => {
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
          if (move({ kind: "purge" }) === "purge") {
            for (const call of calls.values()) {
              cutCall(call.abort, "purged");
            }
            await state.storage.deleteAll();
          }
        },
        threadId,
        transaction: (run) => state.storage.transactionSync(run),
      };
      const handOver = async (turn: {
        readonly text: string;
        readonly turn: number;
        readonly handed: z.infer<typeof handedSchema>;
      }) => {
        const content = turnUserMessage({ text: turn.text, viewContext: null });
        acceptDelivery(
          host,
          {
            content,
            opId: `${threadId}:${String(turn.turn)}`,
            pushedThrough: turn.handed.pushedThrough,
            rules: turn.handed.rules,
            threadId,
            turn: turn.turn,
          },
          await rulesHashOf(turn.handed.rules),
        );
      };
      await handOver({ handed: first, text, turn: 1 });
      const deliver = async (next: string): Promise<number> => {
        const turn =
          (db
            .select({ last: max(threadTurns.turn) })
            .from(threadTurns)
            .get()?.last ?? 0) + 1;
        // a stub made here, inside the thread's object, which may not use one made outside it
        const held = await openTurnInCell(
          { ...account, cell: cellOf(account.accountId) },
          threadId,
          next,
          turn,
        );
        await handOver({ handed: held, text: next, turn });
        return turn;
      };
      const run = async (most = 40): Promise<StepResult[]> => {
        const results: StepResult[] = [];
        let effect: DriveEffect = move({ kind: "kick" }) === "start" ? "step" : "none";
        while (effect === "step" && results.length < most) {
          const result = await step(host);
          results.push(result);
          effect = move({ kind: "stepped", result });
        }
        if (effect === "step") {
          // stopped at `most`, the suite runs it again as a timed retry would
          move({ kind: "stepped", result: "later" });
        }
        return results;
      };
      return await work({ asked, deliver, host, run, sent });
    },
  );
};
