import { DEVICE_API_PATHS } from "@repo/contract/cloud/device/device-schema";
import { VAULT_GIT_PATH } from "@repo/contract/cloud/vault/vault-git";
import { env, exports } from "cloudflare:workers";
import { eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "./db/client";
import { rateLimit } from "./db/schema";
import { deviceRateKey } from "./rate-limit";
import {
  buildHeaders,
  deviceHeaders,
  drained,
  loginDevice,
  ORIGIN,
  postSignOut,
  sessionHeaders,
  signUpUser,
} from "./test-support/cloud-helpers";

const GIT_REFS = `${ORIGIN}${VAULT_GIT_PATH}/info/refs?service=git-upload-pack`;

const spendBudget = async (key: string): Promise<void> => {
  const spent = { count: 1_000_000, lastRequest: Date.now() };
  await createDb(env.DB)
    .insert(rateLimit)
    .values({ id: crypto.randomUUID(), key, ...spent })
    .onConflictDoUpdate({ set: spent, target: rateLimit.key });
};

const gitRefs = async (headers: Record<string, string>): Promise<Response> =>
  await drained(exports.default.fetch(GIT_REFS, { headers }));

describe("the hosted vault's per-device budget", () => {
  // the suite config keeps the limiter off so suites do not 429 on one another
  let wasDisabled: Env["RATE_LIMIT_DISABLED"] = "true";
  beforeEach(() => {
    wasDisabled = env.RATE_LIMIT_DISABLED;
    env.RATE_LIMIT_DISABLED = "false";
  });
  afterEach(() => {
    env.RATE_LIMIT_DISABLED = wasDisabled;
  });

  it("refuses the git remote once the device's budget is spent, and only that device's", async () => {
    const { cookie } = await signUpUser("vault-budget-git@example.test");
    const spent = await loginDevice(cookie, "Laptop");
    const other = await loginDevice(cookie, "Desktop");

    await spendBudget(deviceRateKey("vaultGit", spent.deviceId));

    const refused = await gitRefs(deviceHeaders(spent.credential));
    expect(refused.status).toBe(429);
    const allowed = await gitRefs(deviceHeaders(other.credential));
    expect(allowed.status).not.toBe(429);
  });

  it("drops a revoked device's rows at once, not on Better Auth's next prune", async () => {
    const { cookie } = await signUpUser("vault-budget-revoke@example.test");
    const device = await loginDevice(cookie, "Laptop");
    const keys = [
      deviceRateKey("vaultGit", device.deviceId),
      deviceRateKey("rpc", device.deviceId),
    ];
    for (const key of keys) {
      await spendBudget(key);
    }

    const revoked = await drained(
      exports.default.fetch(`${ORIGIN}${DEVICE_API_PATHS.revoke}`, {
        body: JSON.stringify({ deviceId: device.deviceId }),
        headers: { ...sessionHeaders(cookie), "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(revoked.status).toBe(200);

    const rows = await createDb(env.DB)
      .select()
      .from(rateLimit)
      .where(inArray(rateLimit.key, keys))
      .all();
    expect(rows).toEqual([]);
  });

  it("spends nothing for a credential that never verified", async () => {
    const unauthorized = await gitRefs({
      ...buildHeaders(),
      authorization: "Bearer igd_not-a-real-credential",
    });
    expect(unauthorized.status).toBe(401);
  });
});

describe("a signed-out device's budgets", () => {
  it("go with it, as a revoked device's do", async () => {
    const { cookie } = await signUpUser("vault-budget-signout@example.test");
    const device = await loginDevice(cookie, "Laptop");
    const key = deviceRateKey("vaultGit", device.deviceId);
    await spendBudget(key);

    const signedOut = await drained(postSignOut(deviceHeaders(device.credential)));
    expect(signedOut.status).toBe(200);

    const rows = await createDb(env.DB)
      .select()
      .from(rateLimit)
      .where(eq(rateLimit.key, key))
      .all();
    expect(rows).toEqual([]);
  });
});
