// Every write to an account's library, as one Postgres transaction under the account's row lock:
// writes of one account land in turn, and other accounts' never wait on them. A write takes the
// library's next sequence once, at its first stamping landing, so a write that lands nothing moves
// nothing, joins its turn's change set at its first landing that changes an item when the built-in
// agent made it (`./library-change-sets`), and keeps its answer under its op id, so a client
// resending after a lost answer is told what landed. A rule refuses by throwing
// (`./library-refusal`), which rolls the write back, and `attempt` is a savepoint: a part that lands
// whole or not at all while the write goes on.

import { db } from "@repo/db/drizzle-client";
import type { DbExecutor, Tx } from "@repo/db/drizzle-client";
import { libraryState, opAnswer } from "@repo/db/library-schema";
import { and, eq, sql } from "drizzle-orm";
import type { z } from "zod";

import { joinTurnSet } from "./library-change-sets";
import type { LibraryActor } from "./library-principal";
import { RefusedWriteError, refuse } from "./library-refusal";
import type { LibraryResult } from "./library-refusal";

// How long a write waits for the account's lock. Waiters hold pooled connections, so without a
// bound one account's queue takes every one and stalls every account; it is set inside the
// transaction, since Supabase's pooler drops a connection's startup parameters
const LOCK_TIMEOUT = "5s";
const LOCK_NOT_AVAILABLE = "55P03";
const FOREIGN_KEY_VIOLATION = "23503";

// who a write is by: the account whose library it locks, and the actor its landings are by
export interface LibraryWriter {
  readonly accountId: string;
  readonly actor: LibraryActor;
}

// what a write asks around its work: its key in the op ledger, and the schema its answer is read
// through, as it lands and as the ledger kept it
export interface WriteRequest<S extends z.ZodType> {
  readonly opId: string | undefined;
  readonly answer: S;
}

// an answer as a write's work may build it: its lists read-only, which the answer's schema gives
// back as plain ones
export type Built<T> = T extends readonly (infer E)[]
  ? readonly Built<E>[]
  : T extends object
    ? { readonly [K in keyof T]: Built<T[K]> }
    : T;

// what a write's work lands under: its transaction, its one time, its one sequence number, taken by
// its first stamping landing, and the change set its landings join
export interface WriteScope {
  readonly tx: Tx;
  readonly accountId: string;
  readonly now: number;
  readonly seq: () => Promise<number>;
  // the change set of the built-in agent's turn the write is by, made by the turn's first landing;
  // null for every other writer, whose writes no Undo takes back
  readonly set: () => Promise<string | null>;
  // a part of the write that lands whole or not at all while the write goes on: what it wrote,
  // the sequence it took included, is taken back when a rule refuses it, and the refusal answered
  readonly attempt: <T>(part: (scope: WriteScope) => Promise<T>) => Promise<LibraryResult<T>>;
}

// whether Postgres raised `code` anywhere down the error's causes, which drizzle wraps
const raised = (cause: unknown, code: string): boolean => {
  for (let at = cause; at instanceof Error; at = at.cause) {
    if ("code" in at && at.code === code) {
      return true;
    }
  }
  return false;
};

// Runs `work` in one transaction holding the account's library row, made by the first write of
// the account. Nothing inside awaits anything but `tx`, a file's keep aside
// (`../files/file-landing`): a lock held across a network call stalls every write of the account.
// An account deleted, its row with it, is refused `gone`, whether it went before the write or
// while the write waited on its lock
export const withAccountLock = async <T>(
  accountId: string,
  work: (tx: Tx) => Promise<T>,
): Promise<T> =>
  await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('lock_timeout', ${LOCK_TIMEOUT}, true)`);
    try {
      await tx.insert(libraryState).values({ accountId }).onConflictDoNothing();
    } catch (error) {
      if (raised(error, FOREIGN_KEY_VIOLATION)) {
        refuse({ kind: "gone" });
      }
      throw error;
    }
    const [held] = await tx
      .select({ accountId: libraryState.accountId })
      .from(libraryState)
      .where(eq(libraryState.accountId, accountId))
      .for("update");
    if (held === undefined) {
      refuse({ kind: "gone" });
    }
    return await work(tx);
  });

const isLockTimeout = (cause: unknown): boolean => raised(cause, LOCK_NOT_AVAILABLE);

const takeHead = async (tx: Tx, accountId: string): Promise<number> => {
  const [row] = await tx
    .update(libraryState)
    .set({ head: sql`${libraryState.head} + 1` })
    .where(eq(libraryState.accountId, accountId))
    .returning({ head: libraryState.head });
  if (row === undefined) {
    throw new Error("the account's library row is gone under its own lock");
  }
  return row.head;
};

// the sequence number a write took and the change set it joined, each null until it took one
interface Taken {
  head: number | null;
  set: string | null;
}

const scopeOf = (tx: Tx, writer: LibraryWriter, now: number, taken: Taken): WriteScope => ({
  accountId: writer.accountId,
  attempt: async (part) => {
    const before = { ...taken };
    try {
      const value = await tx.transaction(
        async (nested) => await part(scopeOf(nested, writer, now, taken)),
      );
      return { ok: true, value };
    } catch (error) {
      if (!(error instanceof RefusedWriteError)) {
        throw error;
      }
      taken.head = before.head;
      taken.set = before.set;
      return { ok: false, refusal: error.refusal };
    }
  },
  now,
  seq: async () => {
    taken.head ??= await takeHead(tx, writer.accountId);
    return taken.head;
  },
  set: async () => {
    const { actor } = writer;
    if (actor.kind !== "agent") {
      return null;
    }
    taken.set ??= await joinTurnSet(tx, writer.accountId, actor, now);
    return taken.set;
  },
  tx,
});

// what the op answered when it landed, or null while it has not; a writer that works before its
// write, as an agent's edit does, asks it first, so a resend is answered before that work
export const priorAnswer = async <S extends z.ZodType>(
  reader: DbExecutor,
  accountId: string,
  opId: string,
  answer: S,
): Promise<{ readonly value: z.output<S> } | null> => {
  const [row] = await reader
    .select({ answer: opAnswer.answer })
    .from(opAnswer)
    .where(and(eq(opAnswer.accountId, accountId), eq(opAnswer.opId, opId)));
  return row === undefined ? null : { value: answer.parse(row.answer) };
};

// one write: answered from its op's record when it already landed, else run whole or not at all
export const writeLibrary = async <S extends z.ZodType>(
  writer: LibraryWriter,
  request: WriteRequest<S>,
  work: (scope: WriteScope) => Promise<Built<z.input<S>>>,
): Promise<LibraryResult<z.output<S>>> => {
  const { accountId } = writer;
  const { answer, opId } = request;
  try {
    const value = await withAccountLock(accountId, async (tx): Promise<z.output<S>> => {
      const prior = opId === undefined ? null : await priorAnswer(tx, accountId, opId, answer);
      if (prior !== null) {
        return prior.value;
      }
      const now = Date.now();
      const landed = answer.parse(await work(scopeOf(tx, writer, now, { head: null, set: null })));
      if (opId !== undefined) {
        await tx.insert(opAnswer).values({ accountId, answer: landed, at: now, opId });
      }
      return landed;
    });
    return { ok: true, value };
  } catch (error) {
    if (error instanceof RefusedWriteError) {
      return { ok: false, refusal: error.refusal };
    }
    if (isLockTimeout(error)) {
      return { ok: false, refusal: { kind: "busy" } };
    }
    throw error;
  }
};
