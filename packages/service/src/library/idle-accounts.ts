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
