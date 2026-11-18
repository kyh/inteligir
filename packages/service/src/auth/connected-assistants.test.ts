// What housekeeping forgets of the assistants that registered: a registration no consent or token
// names, once a day has passed since it registered, and never one a grant still names.

import { oauthClient } from "@repo/db/auth-schema";
import { db } from "@repo/db/drizzle-client";
import { dbSuite } from "@repo/db/test-database";
import { inArray } from "drizzle-orm";
import { expect, it } from "vitest";

import { signUpUser, userIdOf } from "../test-support/auth-requests";
import { connectAssistant, registerAssistant } from "../test-support/connector-grants";
import { listAssistants, pruneUnnamedRegistrations, revokeAssistant } from "./connected-assistants";

const FULL = "library:read library offline_access";

const DAY_MS = 24 * 60 * 60 * 1000;

const registered = async (clientIds: readonly string[]): Promise<Set<string>> => {
  const rows = await db
    .select({ clientId: oauthClient.clientId })
    .from(oauthClient)
    .where(inArray(oauthClient.clientId, [...clientIds]));
  return new Set(rows.map(({ clientId }) => clientId));
};

// as if each had registered a day and a minute ago
const registeredDayAgo = async (clientIds: readonly string[]): Promise<void> => {
  await db
    .update(oauthClient)
    .set({ updatedAt: new Date(Date.now() - DAY_MS - 60_000) })
    .where(inArray(oauthClient.clientId, [...clientIds]));
};

dbSuite("what housekeeping forgets of the assistants that registered", () => {
  it("removes a registration nothing names a day on, and keeps one a grant names or a newer one", async () => {
    const { cookie } = await signUpUser("registrations-kept@example.test");
    const stale = await registerAssistant("Stale", "https://stale.example/callback");
    const { clientId: connected } = await connectAssistant("Connected", {
      allowed: FULL,
      cookie,
      scope: FULL,
    });
    const fresh = await registerAssistant("Fresh", "https://fresh.example/callback");
    await registeredDayAgo([stale, connected]);

    await expect(pruneUnnamedRegistrations(Date.now())).resolves.toBe(1);
    await expect(registered([stale, connected, fresh])).resolves.toStrictEqual(
      new Set([connected, fresh]),
    );
  });

  it("removes an assistant's registration once a disconnect leaves nothing naming it", async () => {
    const { cookie } = await signUpUser("registrations-disconnected@example.test");
    const userId = await userIdOf(cookie);
    const { clientId } = await connectAssistant("Disconnected", {
      allowed: FULL,
      cookie,
      scope: FULL,
    });
    await registeredDayAgo([clientId]);
    const [grant] = await listAssistants(userId);
    expect(await revokeAssistant(userId, grant?.grantId ?? "")).toBe(true);

    await expect(pruneUnnamedRegistrations(Date.now())).resolves.toBe(1);
    await expect(registered([clientId])).resolves.toStrictEqual(new Set());
  });
});
