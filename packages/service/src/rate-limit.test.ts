import { randomUUID } from "node:crypto";

import { rateLimit } from "@repo/db/auth-schema";
import { db } from "@repo/db/drizzle-client";
import { dbSuite } from "@repo/db/test-database";
import { eq } from "drizzle-orm";
import { afterEach, expect, it, vi } from "vitest";

import { holderRateKey, RATE_WINDOWS, spendHolderBudget } from "./rate-limit";

const { max, windowMs } = RATE_WINDOWS.accountDelete;

const countOf = async (key: string) => {
  const [row] = await db
    .select({ count: rateLimit.count })
    .from(rateLimit)
    .where(eq(rateLimit.key, key));

  return row?.count;
};

const spendTimes = async (holderId: string, times: number) => {
  const spent = [];

  for (let spend = 0; spend < times; spend += 1) {
    spent.push(await spendHolderBudget("accountDelete", holderId));
  }

  return spent;
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.resetModules();
});

dbSuite("a window", () => {
  it("admits exactly its max of spends made at once, the first of them racing to make the row", async () => {
    const holderId = randomUUID();
    const spends = 8 * max;

    const spent = await Promise.all(
      Array.from(
        { length: spends },
        async () => await spendHolderBudget("accountDelete", holderId),
      ),
    );

    expect(spent.filter(Boolean)).toHaveLength(max);
    await expect(countOf(holderRateKey("accountDelete", holderId))).resolves.toBe(spends);
  });

  it("stays shut to its last millisecond, and opens afresh once it lapsed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const opened = Date.now();
    const holderId = randomUUID();
    await expect(spendTimes(holderId, max + 1)).resolves.toStrictEqual([
      ...Array.from({ length: max }, () => true),
      false,
    ]);

    vi.setSystemTime(opened + windowMs);
    await expect(spendHolderBudget("accountDelete", holderId)).resolves.toBe(false);

    vi.setSystemTime(opened + windowMs + 1);
    await expect(spendTimes(holderId, max + 1)).resolves.toStrictEqual([
      ...Array.from({ length: max }, () => true),
      false,
    ]);
  });

  it("counts each holder apart", async () => {
    const spent = randomUUID();
    await spendTimes(spent, max + 1);

    await expect(spendHolderBudget("accountDelete", randomUUID())).resolves.toBe(true);
  });

  it("counts nothing while RATE_LIMIT_DISABLED is true", async () => {
    vi.stubEnv("RATE_LIMIT_DISABLED", "true");
    vi.resetModules();
    const disabled = await import("./rate-limit");
    const holderId = randomUUID();

    for (let spend = 0; spend <= max; spend += 1) {
      await expect(disabled.spendHolderBudget("accountDelete", holderId)).resolves.toBe(true);
    }

    await expect(countOf(holderRateKey("accountDelete", holderId))).resolves.toBeUndefined();
  });
});
