// The assistants a person let into their library, as Settings › Account lists them, and the one way
// to let one go: its consent and every token minted under it go in one transaction, so its next call
// is refused and its refresh token is dead. A reset password lets every one go.

import {
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
} from "@repo/db/auth-schema";
import { db } from "@repo/db/drizzle-client";
import type { Tx } from "@repo/db/drizzle-client";
import { and, desc, eq } from "drizzle-orm";

import { assistantIdentity, libraryScopesOf } from "./oauth-auth";

export const listAssistants = async (userId: string) => {
  const rows = await db
    .select({
      clientDiscoveryId: oauthClient.clientDiscoveryId,
      clientId: oauthClient.clientId,
      createdAt: oauthConsent.createdAt,
      grantId: oauthConsent.id,
      name: oauthClient.name,
      scopes: oauthConsent.scopes,
    })
    .from(oauthConsent)
    .innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
    .where(eq(oauthConsent.userId, userId))
    .orderBy(desc(oauthConsent.createdAt), desc(oauthConsent.id));
  return rows.map((row) => ({
    clientName: assistantIdentity(row).name,
    createdAt: row.createdAt?.getTime() ?? 0,
    grantId: row.grantId,
    scopes: libraryScopesOf(row.scopes),
  }));
};

// the person's grants, or the one `grantId` names, locked, then their tokens and the grants
// themselves; answers how many went
const revokeGrants = async (tx: Tx, userId: string, grantId?: string): Promise<number> => {
  const grants = await tx
    .select({ clientId: oauthConsent.clientId, id: oauthConsent.id })
    .from(oauthConsent)
    .where(
      and(
        eq(oauthConsent.userId, userId),
        grantId === undefined ? undefined : eq(oauthConsent.id, grantId),
      ),
    )
    .for("update");
  for (const grant of grants) {
    const minted = (table: typeof oauthAccessToken | typeof oauthRefreshToken) =>
      and(eq(table.clientId, grant.clientId), eq(table.userId, userId));
    await tx.delete(oauthAccessToken).where(minted(oauthAccessToken));
    await tx.delete(oauthRefreshToken).where(minted(oauthRefreshToken));
    await tx.delete(oauthConsent).where(eq(oauthConsent.id, grant.id));
  }
  return grants.length;
};

// false when the person holds no grant by that id
export const revokeAssistant = async (userId: string, grantId: string): Promise<boolean> =>
  (await db.transaction(async (tx) => await revokeGrants(tx, userId, grantId))) > 0;

// whoever reset the password should not inherit the assistants connected before
export const revokeAllAssistants = async (userId: string): Promise<void> => {
  await db.transaction(async (tx) => {
    await revokeGrants(tx, userId);
  });
};
