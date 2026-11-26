import { db } from "@repo/db/drizzle-client";
import type { DbExecutor, Tx } from "@repo/db/drizzle-client";
import { libraryState, opAnswer } from "@repo/db/library-schema";
import { and, eq, sql } from "drizzle-orm";
import type { z } from "zod";

import { askJobs } from "./job-queue";
import type { DelayedAsk } from "./job-queue";
import { joinTurnSet } from "./turn-sets";
import type { LibraryActor } from "./library-principal";
import { RefusedWriteError, refuse } from "./library-refusal";
import type { LibraryResult } from "./library-refusal";

const LOCK_TIMEOUT = "5s";
const LOCK_NOT_AVAILABLE = "55P03";
const FOREIGN_KEY_VIOLATION = "23503";

export type JobKick = (accountId: string) => void;

export interface LibraryWriter {
  readonly accountId: string;
  readonly actor: LibraryActor;
  readonly kickJobs?: JobKick;
}

export interface WriteRequest<S extends z.ZodType> {
  readonly opId: string | undefined;
  readonly answer: S;
}

export type Built<T> = T extends readonly (infer E)[]
  ? readonly Built<E>[]
  : T extends object
    ? { readonly [K in keyof T]: Built<T[K]> }
    : T;

export interface WriteScope {
  readonly tx: Tx;
  readonly accountId: string;
  readonly now: number;
  readonly seq: () => Promise<number>;
  readonly set: () => Promise<string | null>;
  readonly attempt: <T>(part: (scope: WriteScope) => Promise<T>) => Promise<LibraryResult<T>>;
  readonly askJobs: (asks: readonly Omit<DelayedAsk, "accountId">[]) => Promise<void>;
}

const raised = (cause: unknown, code: string) => {
  for (let at = cause; at instanceof Error; at = at.cause) {
    if ("code" in at && at.code === code) {
      return true;
    }
  }

  return false;
};

const lockLibraryRow = async (tx: Tx, accountId: string) => {
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
};

export const withAccountLock = async <T>(accountId: string, work: (tx: Tx) => Promise<T>) =>
  await db.transaction(async (tx) => {
    await lockLibraryRow(tx, accountId);

    return await work(tx);
  });

const isLockTimeout = (cause: unknown) => raised(cause, LOCK_NOT_AVAILABLE);

const takeHead = async (tx: Tx, accountId: string) => {
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

export const takeLibraryHead = async (tx: Tx, accountId: string) => {
  await lockLibraryRow(tx, accountId);

  return await takeHead(tx, accountId);
};

interface Taken {
  head: number | null;
  jobs: boolean;
  set: string | null;
}

const scopeOf: (tx: Tx, writer: LibraryWriter, now: number, taken: Taken) => WriteScope = (
  tx: Tx,
  writer: LibraryWriter,
  now: number,
  taken: Taken,
) =>
  ({
    accountId: writer.accountId,
    askJobs: async (asks) => {
      if (asks.length === 0) {
        return;
      }

      await askJobs(
        tx,
        asks.map((ask) => ({ ...ask, accountId: writer.accountId })),
        now,
      );
      taken.jobs = true;
    },
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
        taken.jobs = before.jobs;

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
  }) satisfies WriteScope;

export const priorAnswer = async <S extends z.ZodType>(
  reader: DbExecutor,
  accountId: string,
  opId: string,
  answer: S,
) => {
  const [row] = await reader
    .select({ answer: opAnswer.answer })
    .from(opAnswer)
    .where(and(eq(opAnswer.accountId, accountId), eq(opAnswer.opId, opId)));

  return (row === undefined ? null : { value: answer.parse(row.answer) }) satisfies {
    readonly value: z.output<S>;
  } | null;
};

export const writeLibrary = async <S extends z.ZodType>(
  writer: LibraryWriter,
  request: WriteRequest<S>,
  work: (scope: WriteScope) => Promise<Built<z.input<S>>>,
) => {
  const { accountId } = writer;
  const { answer, opId } = request;
  const taken: Taken = { head: null, jobs: false, set: null };

  try {
    const value = await withAccountLock(accountId, async (tx) => {
      const prior = opId === undefined ? null : await priorAnswer(tx, accountId, opId, answer);

      if (prior !== null) {
        return prior.value;
      }

      const now = Date.now();
      const landed = answer.parse(await work(scopeOf(tx, writer, now, taken)));

      if (opId !== undefined) {
        await tx.insert(opAnswer).values({ accountId, answer: landed, at: now, opId });
      }

      return landed;
    });

    if (taken.jobs) {
      writer.kickJobs?.(accountId);
    }

    return { ok: true, value } satisfies LibraryResult<z.output<S>>;
  } catch (error) {
    if (error instanceof RefusedWriteError) {
      return { ok: false, refusal: error.refusal } satisfies LibraryResult<z.output<S>>;
    }

    if (isLockTimeout(error)) {
      return { ok: false, refusal: { kind: "busy" } } satisfies LibraryResult<z.output<S>>;
    }

    throw error;
  }
};
