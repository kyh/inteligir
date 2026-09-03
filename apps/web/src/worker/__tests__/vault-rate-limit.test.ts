import { DEVICE_API_PATHS } from "@repo/api/cloud/device/device-schema";
import { VAULT_API_PATHS } from "@repo/api/cloud/vault/vault-schema";
import { VAULT_GIT_PATH } from "@repo/api/cloud/vault/vault-git";
import { cloudErrorSchema } from "@repo/api/cloud/errors";
import { env, SELF } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../db/client";
import { rateLimit } from "../db/schema";
import { deviceRateKey } from "../rate-limit";
import { deviceHeaders, ORIGIN, loginDevice, sessionHeaders, signUpUser } from "./cloud-helpers";

const TREE = `${ORIGIN}${VAULT_API_PATHS.tree}`;
const GIT_REFS = `${ORIGIN}${VAULT_GIT_PATH}/info/refs?service=git-upload-pack`;

async function spendBudget(key: string): Promise<void> {
  const spent = { count: 1_000_000, lastRequest: Date.now() };
  await createDb(env.DB)
    .insert(rateLimit)
    .values({ id: crypto.randomUUID(), key, ...spent })
    .onConflictDoUpdate({ target: rateLimit.key, set: spent });
}

describe("the hosted vault's per-device budgets", () => {
  // the suite config keeps the limiter off so suites do not 429 on one another
  let wasDisabled = "";
  beforeEach(() => {
    wasDisabled = env.RATE_LIMIT_DISABLED;
    env.RATE_LIMIT_DISABLED = "false";
  });
  afterEach(() => {
    env.RATE_LIMIT_DISABLED = wasDisabled;
  });

  it("refuses vault reads once the device's budget is spent, and only that device's", async () => {
    const { bearer } = await signUpUser("vault-budget-read@example.test");
    const phone = await loginDevice(bearer, "Phone");
    const laptop = await loginDevice(bearer, "Laptop");

    await spendBudget(deviceRateKey("vaultRead", phone.deviceId));

    const refused = await SELF.fetch(TREE, { headers: deviceHeaders(phone.credential) });
    expect(refused.status).toBe(429);
    expect(cloudErrorSchema.parse(await refused.json()).error.code).toBe("rate-limited");

    const allowed = await SELF.fetch(TREE, { headers: deviceHeaders(laptop.credential) });
    expect(allowed.status).not.toBe(429);
  });

  it("keeps the git remote's budget separate from the read rows'", async () => {
    const { bearer } = await signUpUser("vault-budget-families@example.test");
    const device = await loginDevice(bearer, "Laptop");

    await spendBudget(deviceRateKey("vaultRead", device.deviceId));

    const git = await SELF.fetch(GIT_REFS, { headers: deviceHeaders(device.credential) });
    expect(git.status).not.toBe(429);

    await spendBudget(deviceRateKey("vaultGit", device.deviceId));
    const refused = await SELF.fetch(GIT_REFS, { headers: deviceHeaders(device.credential) });
    expect(refused.status).toBe(429);
  });

  it("drops a revoked device's rows — nothing else ever deletes one", async () => {
    const { bearer } = await signUpUser("vault-budget-revoke@example.test");
    const device = await loginDevice(bearer, "Laptop");
    const key = deviceRateKey("vaultRead", device.deviceId);
    await spendBudget(key);

    const revoked = await SELF.fetch(`${ORIGIN}${DEVICE_API_PATHS.revoke}`, {
      method: "POST",
      headers: { ...sessionHeaders(bearer), "content-type": "application/json" },
      body: JSON.stringify({ deviceId: device.deviceId }),
    });
    expect(revoked.status).toBe(200);

    const rows = await createDb(env.DB)
      .select()
      .from(rateLimit)
      .where(eq(rateLimit.key, key))
      .all();
    expect(rows).toEqual([]);
  });

  it("spends nothing for a credential that never verified", async () => {
    const unauthorized = await SELF.fetch(TREE, {
      headers: { authorization: "Bearer igd_not-a-real-credential" },
    });
    expect(unauthorized.status).toBe(401);
  });
});
