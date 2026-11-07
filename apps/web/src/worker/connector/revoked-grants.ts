// The grants a person disconnected, one row each in D1 for as long as the account lives. The grant
// itself is in KV, which has no compare-and-swap: a refresh that read it before the revoke deleted
// it writes it back after, with fresh tokens. So the row decides, not the grant's absence: the
// token exchange refuses a grant with one, and so does every call on the connector, since neither
// the provider's token check nor a token already minted looks at the grant.

import { eq } from "drizzle-orm";

import type { Db } from "../db/client";
import { revokedGrant } from "../db/schema";

export const markGrantRevoked = async (
  db: Db,
  grant: { readonly accountId: string; readonly grantId: string },
): Promise<void> => {
  await db
    .insert(revokedGrant)
    .values({ grantId: grant.grantId, userId: grant.accountId })
    .onConflictDoNothing();
};

export const isGrantRevoked = async (db: Db, grantId: string): Promise<boolean> => {
  const row = await db
    .select({ grantId: revokedGrant.grantId })
    .from(revokedGrant)
    .where(eq(revokedGrant.grantId, grantId))
    .get();
  return row !== undefined;
};

export const revokedGrantIds = async (db: Db, accountId: string): Promise<ReadonlySet<string>> => {
  const rows = await db
    .select({ grantId: revokedGrant.grantId })
    .from(revokedGrant)
    .where(eq(revokedGrant.userId, accountId));
  return new Set(rows.map((row) => row.grantId));
};
