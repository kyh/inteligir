// Of the accounts holding some rows, those no write holds now, each locked as a write locks it until
// the caller's transaction ends: housekeeping takes them and leaves a busy one for its next run, so
// it never waits on a write nor races one.

import type { Tx } from "@repo/db/drizzle-client";
import { libraryState } from "@repo/db/library-schema";
import { inArray } from "drizzle-orm";
import type { SQLWrapper } from "drizzle-orm";

export const idleAccounts = (tx: Tx, holding: SQLWrapper) =>
  tx
    .select({ accountId: libraryState.accountId })
    .from(libraryState)
    .where(inArray(libraryState.accountId, holding))
    .for("update", { skipLocked: true });
