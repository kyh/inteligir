import { DEVICE_API_PATHS } from "@repo/api/cloud/device/device-schema";
import { VAULT_API_PATHS } from "@repo/api/cloud/vault/vault-schema";
import { VAULT_GIT_PATH } from "@repo/api/cloud/vault/vault-git";
import { cloudErrorSchema } from "@repo/api/cloud/errors";
import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../db/client";
import { rateLimit } from "../db/schema";
import { deviceRateKey } from "../rate-limit";
import {
  deviceHeaders,
  emitted,
  ORIGIN,
  loginDevice,
  postSignOut,
  sessionHeaders,
  signUpUser,
} from "./cloud-helpers";
import { pushVaultFiles, ZERO_OID } from "./git-pack";

const TREE = `${ORIGIN}${VAULT_API_PATHS.tree}`;
const FILES = `${ORIGIN}${VAULT_API_PATHS.files}`;
const COMMIT = `${ORIGIN}${VAULT_API_PATHS.commit}`;
const GIT_REFS = `${ORIGIN}${VAULT_GIT_PATH}/info/refs?service=git-upload-pack`;

const spendBudget = async (key: string): Promise<void> => {
  const spent = { count: 1_000_000, lastRequest: Date.now() };
  await createDb(env.DB)
    .insert(rateLimit)
    .values({ id: crypto.randomUUID(), key, ...spent })
    .onConflictDoUpdate({ set: spent, target: rateLimit.key });
};

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
    expect(emitted(cloudErrorSchema, await refused.text()).error.code).toBe("rate-limited");

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

  it("drops a revoked device's rows at once, not on Better Auth's next prune", async () => {
    const { bearer } = await signUpUser("vault-budget-revoke@example.test");
    const device = await loginDevice(bearer, "Laptop");
    const keys = [
      deviceRateKey("vaultRead", device.deviceId),
      deviceRateKey("vaultGit", device.deviceId),
      deviceRateKey("vaultWrite", device.deviceId),
    ];
    for (const key of keys) {
      await spendBudget(key);
    }

    const revoked = await SELF.fetch(`${ORIGIN}${DEVICE_API_PATHS.revoke}`, {
      body: JSON.stringify({ deviceId: device.deviceId }),
      headers: { ...sessionHeaders(bearer), "content-type": "application/json" },
      method: "POST",
    });
    expect(revoked.status).toBe(200);

    const rows = await createDb(env.DB)
      .select()
      .from(rateLimit)
      .where(inArray(rateLimit.key, keys))
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

// outside the window above: a fourth sign-up there meets better auth's own sign-up throttle
describe("a batch read's budget", () => {
  it("spends one unit for the whole batch, however many paths it names", async () => {
    const { bearer } = await signUpUser("vault-budget-batch@example.test");
    const phone = await loginDevice(bearer, "Phone");
    const paths = ["a.md", "b.md", "c.md", "notes/d.md"];
    const pushed = await pushVaultFiles(
      phone.credential,
      "vault: initialize",
      paths.map((path) => ({ content: `# ${path}\n`, path })),
      ZERO_OID,
    );
    expect(pushed.response.status).toBe(200);

    const wasDisabled = env.RATE_LIMIT_DISABLED;
    env.RATE_LIMIT_DISABLED = "false";
    try {
      const batch = await SELF.fetch(FILES, {
        body: JSON.stringify({ paths, ref: pushed.commit }),
        headers: { ...deviceHeaders(phone.credential), "content-type": "application/json" },
        method: "POST",
      });
      expect(batch.status).toBe(200);
    } finally {
      env.RATE_LIMIT_DISABLED = wasDisabled;
    }

    const rows = await createDb(env.DB)
      .select({ count: rateLimit.count })
      .from(rateLimit)
      .where(eq(rateLimit.key, deviceRateKey("vaultRead", phone.deviceId)))
      .all();
    expect(rows).toEqual([{ count: 1 }]);
  });
});

describe("a vault write's budget", () => {
  it("refuses a commit once spent, and leaves the reads and the git remote whole", async () => {
    const { bearer } = await signUpUser("vault-budget-write@example.test");
    const phone = await loginDevice(bearer, "Phone");
    const pushed = await pushVaultFiles(
      phone.credential,
      "vault: initialize",
      [{ content: "# a\n", path: "a.md" }],
      ZERO_OID,
    );
    expect(pushed.response.status).toBe(200);
    await pushed.response.arrayBuffer();
    await spendBudget(deviceRateKey("vaultWrite", phone.deviceId));

    const wasDisabled = env.RATE_LIMIT_DISABLED;
    env.RATE_LIMIT_DISABLED = "false";
    try {
      const refused = await SELF.fetch(COMMIT, {
        body: JSON.stringify({
          changes: [
            { base: null, content: { encoding: "utf-8", text: "# b\n" }, op: "put", path: "b.md" },
          ],
        }),
        headers: { ...deviceHeaders(phone.credential), "content-type": "application/json" },
        method: "POST",
      });
      expect(refused.status).toBe(429);
      expect(emitted(cloudErrorSchema, await refused.text()).error.code).toBe("rate-limited");

      const tree = await SELF.fetch(TREE, { headers: deviceHeaders(phone.credential) });
      expect(tree.status).toBe(200);
      await tree.arrayBuffer();
      const git = await SELF.fetch(GIT_REFS, { headers: deviceHeaders(phone.credential) });
      expect(git.status).toBe(200);
      await git.arrayBuffer();
    } finally {
      env.RATE_LIMIT_DISABLED = wasDisabled;
    }
  });
});

describe("a signed-out device's budgets", () => {
  it("go with it, as a revoked device's do", async () => {
    const { bearer } = await signUpUser("vault-budget-signout@example.test");
    const device = await loginDevice(bearer, "Laptop");
    const key = deviceRateKey("vaultRead", device.deviceId);
    await spendBudget(key);

    const signedOut = await postSignOut(deviceHeaders(device.credential));
    expect(signedOut.status).toBe(200);

    const rows = await createDb(env.DB)
      .select()
      .from(rateLimit)
      .where(eq(rateLimit.key, key))
      .all();
    expect(rows).toEqual([]);
  });
});
