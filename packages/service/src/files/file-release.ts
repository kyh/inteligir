// A file the library lets go: one no item and no change set has named for a day (`./file-names`).
// Hourly housekeeping deletes its row under its account's lock and asks a `file-release` job, which
// removes its object from the store once that commits. The object's pathname is its upload's own,
// so the same bytes uploaded again land at another and never meet the removal.

import type { Tx } from "@repo/db/drizzle-client";
import { changeSetFile, file, itemFile } from "@repo/db/library-schema";
import { and, eq, lt, notExists, sql } from "drizzle-orm";
import { z } from "zod";

import { askJobs } from "../jobs/job-queue";
import type { JobRun } from "../jobs/job-kinds";
import { idleAccounts } from "../library/idle-accounts";
import { anyOf } from "../library/set-sql";
import { FILE_STORE } from "./file-store-of";

// how long a file waits, unnamed, before it goes: past an upload settled and not yet named by the
// write it was sent for, or a picture cut from one note and pasted into another
const UNNAMED_HOLD_MS = 24 * 60 * 60_000;

const releaseSchema = z.object({ pathname: z.string() });

// about a day of the drain's backoff, past any outage of the store: a removal refused longer is
// the object's own, which no later try gets past
const RELEASE_TRIES = 30;

// the store's removal, again until it goes through or its tries run out, each failure logged by
// the drain; an object still there past them is logged once, for its removal by hand
export const RELEASE_RUN: JobRun<z.output<typeof releaseSchema>> = {
  payload: releaseSchema,
  run: async ({ pathname }) => {
    await FILE_STORE.remove(pathname);
    return "done";
  },
  tries: {
    exhausted: async ({ pathname }) => {
      console.error({ event: "file-release-exhausted", pathname, tries: RELEASE_TRIES });
      // the hook's type is async, and nothing here waits
      await Promise.resolve();
    },
    kind: "at-most",
    max: RELEASE_TRIES,
  },
};

const namedBy = (tx: Tx, names: typeof itemFile | typeof changeSetFile) =>
  tx
    .select({ named: sql`1` })
    .from(names)
    .where(and(eq(names.accountId, file.accountId), eq(names.sha256, file.sha256)));

// Every file unnamed past the hold, of each account no write holds: its row deleted and its
// object's removal asked. Callable inside the caller's transaction; answers how many went. What is
// unnamed is read again once the accounts are locked, by a statement of its own, so a name a write
// committed while the lock was waited on keeps its file
export const releaseUnnamedFiles = async (tx: Tx, now: number): Promise<number> => {
  const unnamed = and(
    lt(file.touchedAt, now - UNNAMED_HOLD_MS),
    notExists(namedBy(tx, itemFile)),
    notExists(namedBy(tx, changeSetFile)),
  );
  const held = await idleAccounts(
    tx,
    tx.selectDistinct({ accountId: file.accountId }).from(file).where(unnamed),
  );
  if (held.length === 0) {
    return 0;
  }
  const released = await tx
    .delete(file)
    .where(
      and(
        anyOf(
          file.accountId,
          held.map(({ accountId }) => accountId),
        ),
        unnamed,
      ),
    )
    .returning({ accountId: file.accountId, pathname: file.pathname });
  await askJobs(
    tx,
    released.map(({ accountId, pathname }) => ({
      accountId,
      id: `release:${pathname}`,
      kind: "file-release" as const,
      payload: { pathname },
    })),
    now,
  );
  return released.length;
};
