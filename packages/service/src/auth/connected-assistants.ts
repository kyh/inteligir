import {
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
} from "@repo/db/auth-schema";
import { db } from "@repo/db/drizzle-client";
import type { Tx } from "@repo/db/drizzle-client";
import { and, desc, eq, lt, notExists } from "drizzle-orm";

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

const revokeGrants = async (tx: Tx, userId: string, grantId?: string) => {
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
    await tx
      .update(oauthClient)
      .set({ updatedAt: new Date() })
      .where(eq(oauthClient.clientId, grant.clientId));
  }

  return grants.length;
};

export const revokeAssistant = async (userId: string, grantId: string) =>
  (await db.transaction(async (tx) => await revokeGrants(tx, userId, grantId))) > 0;

export const revokeAllAssistants = async (userId: string) => {
  await db.transaction(async (tx) => {
    await revokeGrants(tx, userId);
  });
};

const UNNAMED_REGISTRATION_MS = 24 * 60 * 60 * 1000;

const unnamedBy = (
  table: typeof oauthConsent | typeof oauthAccessToken | typeof oauthRefreshToken,
) =>
  notExists(
    db
      .select({ clientId: table.clientId })
      .from(table)
      .where(eq(table.clientId, oauthClient.clientId)),
  );

export const pruneUnnamedRegistrations = async (now: number) => {
  const pruned = await db
    .delete(oauthClient)
    .where(
      and(
        lt(oauthClient.updatedAt, new Date(now - UNNAMED_REGISTRATION_MS)),
        unnamedBy(oauthConsent),
        unnamedBy(oauthAccessToken),
        unnamedBy(oauthRefreshToken),
      ),
    )
    .returning({ clientId: oauthClient.clientId });

  return pruned.length;
};
