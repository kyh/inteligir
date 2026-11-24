import type { Tx } from "@repo/db/drizzle-client";
import { changeSetFile, file, itemFile } from "@repo/db/library-schema";
import { and, eq, lt, notExists, sql } from "drizzle-orm";
import { z } from "zod";

import { askJobs } from "../library/job-queue";
import type { JobRun } from "../library/job-queue";
import { idleAccounts } from "../library/idle-accounts";
import { anyOf } from "../library/set-sql";
import { FILE_STORE } from "./file-store-of";

const UNNAMED_HOLD_MS = 24 * 60 * 60_000;

const releaseSchema = z.object({ pathname: z.string() });

const RELEASE_TRIES = 30;

export const RELEASE_RUN: JobRun<z.output<typeof releaseSchema>> = {
  payload: releaseSchema,
  run: async ({ pathname }) => {
    await FILE_STORE.remove(pathname);

    return "done";
  },
  tries: {
    exhausted: async ({ pathname }) => {
      console.error({ event: "file-release-exhausted", pathname, tries: RELEASE_TRIES });
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

export const releaseUnnamedFiles = async (tx: Tx, now: number) => {
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
