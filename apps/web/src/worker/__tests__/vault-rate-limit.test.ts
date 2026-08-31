import { VAULT_API_PATHS } from "@repo/api/cloud/vault/vault-schema";
import { VAULT_GIT_PATH } from "@repo/api/cloud/vault/vault-git";
import { cloudErrorSchema } from "@repo/api/cloud/errors";
import { env, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../db/client";
import { rateLimit } from "../db/schema";
import { deviceHeaders, ORIGIN, pairDevice, signUpUser } from "./cloud-helpers";

// A verified credential reads the whole vault — the account IS the entitlement
// — so the budget on these two families is what bounds how fast a STOLEN one
// drains it, and therefore whether the dashboard's revoke button arrives in
// time to matter. The suite spends a budget by seeding its row rather than by
// issuing six hundred requests: what is under test is that the path consumes
// one, whose it consumes, and that the two families are separate.

const TREE = `${ORIGIN}${VAULT_API_PATHS.tree}`;
const GIT_REFS = `${ORIGIN}${VAULT_GIT_PATH}/info/refs?service=git-upload-pack`;

/** Every budget is spent, for whatever the ceiling is: the assertion is that
 *  the route ASKS, not what number it asks about. */
async function spendBudget(key: string): Promise<void> {
  const spent = { count: 1_000_000, lastRequest: Date.now() };
  await createDb(env.DB)
    .insert(rateLimit)
    .values({ id: crypto.randomUUID(), key, ...spent })
    .onConflictDoUpdate({ target: rateLimit.key, set: spent });
}

describe("the hosted vault's per-device budgets", () => {
  beforeEach(() => {
    env.RATE_LIMIT_DISABLED = "false";
  });
  afterEach(() => {
    env.RATE_LIMIT_DISABLED = "true";
  });

  it("refuses vault reads once the device's budget is spent, and only that device's", async () => {
    const { bearer } = await signUpUser("vault-budget-read@example.test");
    const phone = await pairDevice(bearer, "Phone");
    const laptop = await pairDevice(bearer, "Laptop");

    await spendBudget(`vault-read:${phone.deviceId}`);

    const refused = await SELF.fetch(TREE, { headers: deviceHeaders(phone.credential) });
    expect(refused.status).toBe(429);
    expect(cloudErrorSchema.parse(await refused.json()).error.code).toBe("rate-limited");

    // Keyed on the DEVICE, not the account: revoking one device is the fix,
    // and a shared bucket would take the user's other devices down with it.
    const allowed = await SELF.fetch(TREE, { headers: deviceHeaders(laptop.credential) });
    expect(allowed.status).not.toBe(429);
  });

  it("keeps the git remote's budget separate from the read rows'", async () => {
    const { bearer } = await signUpUser("vault-budget-families@example.test");
    const device = await pairDevice(bearer, "Laptop");

    await spendBudget(`vault-read:${device.deviceId}`);

    const git = await SELF.fetch(GIT_REFS, { headers: deviceHeaders(device.credential) });
    expect(git.status).not.toBe(429);

    await spendBudget(`vault-git:${device.deviceId}`);
    const refused = await SELF.fetch(GIT_REFS, { headers: deviceHeaders(device.credential) });
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("60");
  });

  it("spends nothing for a credential that never verified", async () => {
    // The budget is keyed on a VERIFIED device, so an unauthenticated caller
    // cannot spend one — including a real device's, by presenting its id.
    const unauthorized = await SELF.fetch(TREE, {
      headers: { authorization: "Bearer igd_not-a-real-credential" },
    });
    expect(unauthorized.status).toBe(401);
  });
});
