import {
  ACCOUNT_API_PATHS,
  deleteAccountResponseSchema,
} from "@repo/api/cloud/account/account-schema";
import { cloudErrorSchema } from "@repo/api/cloud/errors";
import { runInDurableObject, SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../db/client";
import { inviteCode, rateLimit, session, user } from "../db/schema";
import { deviceRateKey } from "../rate-limit";
import { threadSyncStub } from "../sync/routes";
import { vaultRepoName, vaultRegistry } from "../vault/git-remote";
import {
  deviceHeaders,
  emitted,
  loginDevice,
  ORIGIN,
  PASSWORD,
  postSignOut,
  sessionHeaders,
  signUpUser,
  userIdOf,
} from "./cloud-helpers";
import { pushVaultFiles, ZERO_OID } from "./git-pack";

const DELETE = `${ORIGIN}${ACCOUNT_API_PATHS.delete}`;
const ACCOUNT = `${ORIGIN}${ACCOUNT_API_PATHS.account}`;

const postDelete = async (
  authorization: Record<string, string>,
  password: string,
): Promise<Response> =>
  await SELF.fetch(DELETE, {
    body: JSON.stringify({ password }),
    headers: { ...authorization, "content-type": "application/json" },
    method: "POST",
  });

const refusalCode = async (response: Response): Promise<string> =>
  emitted(cloudErrorSchema, await response.text()).error.code;

const userExists = async (userId: string): Promise<boolean> =>
  (await createDb(env.DB).select().from(user).where(eq(user.id, userId)).get()) !== undefined;

const inviteOf = async (email: string) =>
  await createDb(env.DB)
    .select()
    .from(inviteCode)
    .where(sql`lower(${inviteCode.redeemedBy}) = lower(${email})`)
    .get();

describe("deleting the account from a device", () => {
  it("re-checks the password and deletes everything the account holds", async () => {
    const email = "delete-from-app@example.test";
    const { bearer } = await signUpUser(email);
    const laptop = await loginDevice(bearer, "Laptop");
    const phone = await loginDevice(bearer, "Phone");
    const userId = await userIdOf(bearer);
    const invite = await inviteOf(email);
    expect(invite).toBeDefined();

    const pushed = await pushVaultFiles(
      laptop.credential,
      "vault: initialize",
      [{ content: "a note the deletion covers\n", path: "note.md" }],
      ZERO_OID,
      { length: "undeclared" },
    );
    expect(pushed.response.status).toBe(200);
    await pushed.response.arrayBuffer();
    const synced = await SELF.fetch(`${ORIGIN}/v1/sync/push`, {
      body: JSON.stringify({
        events: [{ createdAt: 1, deviceSeq: 1, event: { type: "test" }, threadId: "th_1" }],
      }),
      headers: { ...deviceHeaders(laptop.credential), "content-type": "application/json" },
      method: "POST",
    });
    expect(synced.status).toBe(200);
    const captured = await SELF.fetch(`${ORIGIN}/v1/capture`, {
      body: JSON.stringify({ idempotencyKey: "key-delete-1", text: "a capture" }),
      headers: { ...deviceHeaders(phone.credential), "content-type": "application/json" },
      method: "POST",
    });
    expect(captured.status).toBe(200);

    const deletion = await postDelete(deviceHeaders(laptop.credential), PASSWORD);
    expect(deletion.status).toBe(200);
    expect(emitted(deleteAccountResponseSchema, await deletion.text())).toEqual({
      deleted: true,
    });

    expect(await userExists(userId)).toBe(false);
    for (const credential of [laptop.credential, phone.credential]) {
      const refused = await SELF.fetch(ACCOUNT, { headers: deviceHeaders(credential) });
      expect(refused.status).toBe(401);
    }
    // the sign-in that checked the password minted a session; none outlives the account
    const sessions = await createDb(env.DB)
      .select()
      .from(session)
      .where(eq(session.userId, userId))
      .all();
    expect(sessions).toEqual([]);

    // read off the SQL: every route refuses a tombstoned object, so an answer would prove only the tombstone
    const rows = await runInDurableObject(threadSyncStub(env, userId), (_instance, state) => ({
      captures: state.storage.sql.exec("SELECT COUNT(*) AS n FROM captures").one().n,
      dispatches: state.storage.sql.exec("SELECT COUNT(*) AS n FROM dispatches").one().n,
      events: state.storage.sql.exec("SELECT COUNT(*) AS n FROM sync_events").one().n,
    }));
    expect(rows).toEqual({ captures: 0, dispatches: 0, events: 0 });

    expect(await vaultRegistry(env).get(vaultRepoName(userId))).toBeNull();

    const spent = await createDb(env.DB)
      .select()
      .from(inviteCode)
      .where(eq(inviteCode.code, invite?.code ?? ""))
      .get();
    expect(spent?.redeemedBy).toBeNull();
    expect(spent?.redeemedAt).not.toBeNull();
  });

  it("refuses a wrong password as invalid-credentials, and deletes nothing", async () => {
    const { bearer } = await signUpUser("delete-wrong-password@example.test");
    const { credential } = await loginDevice(bearer, "Laptop");
    const userId = await userIdOf(bearer);

    const refused = await postDelete(deviceHeaders(credential), "not-the-password");
    expect(refused.status).toBe(401);
    expect(await refusalCode(refused)).toBe("invalid-credentials");

    expect(await userExists(userId)).toBe(true);
    const account = await SELF.fetch(ACCOUNT, { headers: deviceHeaders(credential) });
    expect(account.status).toBe(200);
    const sessions = await createDb(env.DB)
      .select()
      .from(session)
      .where(eq(session.userId, userId))
      .all();
    // the sign-up's own session, which the test holds as its bearer
    expect(sessions).toHaveLength(1);
  });

  it("refuses a caller with no device credential, and deletes nothing", async () => {
    const { bearer } = await signUpUser("delete-no-credential@example.test");
    const { credential } = await loginDevice(bearer, "Laptop");
    const revoked = await loginDevice(bearer, "Old Phone");
    const signedOut = await postSignOut(deviceHeaders(revoked.credential));
    expect(signedOut.status).toBe(200);
    const userId = await userIdOf(bearer);

    const callers = [
      { caller: "a browser session", headers: sessionHeaders(bearer) },
      { caller: "a revoked credential", headers: deviceHeaders(revoked.credential) },
      { caller: "no credential", headers: {} },
    ];
    for (const { caller, headers } of callers) {
      const refused = await postDelete(headers, PASSWORD);
      expect(refused.status, caller).toBe(401);
      expect(await refusalCode(refused), caller).toBe("unauthorized");
    }

    expect(await userExists(userId)).toBe(true);
    const account = await SELF.fetch(ACCOUNT, { headers: deviceHeaders(credential) });
    expect(account.status).toBe(200);
  });
});

describe("the deletion's per-device budget", () => {
  // the suite config keeps the limiter off so suites do not 429 on one another
  let wasDisabled = "";
  beforeEach(() => {
    wasDisabled = env.RATE_LIMIT_DISABLED;
    env.RATE_LIMIT_DISABLED = "false";
  });
  afterEach(() => {
    env.RATE_LIMIT_DISABLED = wasDisabled;
  });

  it("refuses the device past its window before checking the password", async () => {
    const { bearer } = await signUpUser("delete-budget@example.test");
    const { credential, deviceId } = await loginDevice(bearer, "Laptop");
    const userId = await userIdOf(bearer);
    const spent = { count: 1_000_000, lastRequest: Date.now() };
    await createDb(env.DB)
      .insert(rateLimit)
      .values({ id: crypto.randomUUID(), key: deviceRateKey("accountDelete", deviceId), ...spent })
      .onConflictDoUpdate({ set: spent, target: rateLimit.key });

    const refused = await postDelete(deviceHeaders(credential), PASSWORD);
    expect(refused.status).toBe(429);
    expect(await refusalCode(refused)).toBe("rate-limited");
    expect(await userExists(userId)).toBe(true);
  });
});
