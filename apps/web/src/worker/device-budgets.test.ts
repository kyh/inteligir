import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { V1_RPC_PATH } from "@repo/contract/cloud/v1";
import type { V1Client } from "@repo/contract/cloud/v1";
import { env, exports } from "cloudflare:workers";
import { inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "./db/client";
import { rateLimit } from "./db/schema";
import { holderRateKey } from "./rate-limit";
import {
  deviceHeaders,
  loginDevice,
  ORIGIN,
  sessionHeaders,
  signUpUser,
} from "./test-support/cloud-helpers";

const v1 = (headers: Record<string, string>): V1Client =>
  createORPCClient<V1Client>(
    new RPCLink({
      fetch: async (url, init) => await exports.default.fetch(url, init),
      headers,
      origin: ORIGIN,
      url: V1_RPC_PATH,
    }),
  );

const spendBudget = async (key: string): Promise<void> => {
  const spent = { count: 1_000_000, lastRequest: Date.now() };
  await createDb(env.DB)
    .insert(rateLimit)
    .values({ id: crypto.randomUUID(), key, ...spent })
    .onConflictDoUpdate({ set: spent, target: rateLimit.key });
};

const rowsOf = async (keys: readonly string[]) =>
  await createDb(env.DB).select().from(rateLimit).where(inArray(rateLimit.key, keys)).all();

const budgetKeys = (deviceId: string): string[] => [
  holderRateKey("rpc", deviceId),
  holderRateKey("blobs", deviceId),
];

// Better Auth's prune reaches a row only once its window lapsed; a device that is gone names
// nobody, so its windows go with it at once
describe("a device's budgets", () => {
  it("go at once when the device is revoked", async () => {
    const { cookie } = await signUpUser("budget-revoke@example.test");
    const device = await loginDevice(cookie, "Laptop");
    const keys = budgetKeys(device.deviceId);
    for (const key of keys) {
      await spendBudget(key);
    }

    await v1(sessionHeaders(cookie)).account.devices.revoke({ deviceId: device.deviceId });

    await expect(rowsOf(keys)).resolves.toStrictEqual([]);
  });

  it("go with it when it signs itself out", async () => {
    const { cookie } = await signUpUser("budget-signout@example.test");
    const device = await loginDevice(cookie, "Laptop");
    const keys = budgetKeys(device.deviceId);
    for (const key of keys) {
      await spendBudget(key);
    }

    await v1(deviceHeaders(device.credential)).account.signOut();

    await expect(rowsOf(keys)).resolves.toStrictEqual([]);
  });
});
