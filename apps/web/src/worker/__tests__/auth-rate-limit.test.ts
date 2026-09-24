import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb } from "../db/client";
import { rateLimit } from "../db/schema";
import {
  AUTH_RATE_WINDOW_SECONDS,
  CALLER_IP_HEADER,
  callerRateKey,
  RATE_WINDOWS,
} from "../rate-limit";
import { ORIGIN } from "./cloud-helpers";

// two hops: Better Auth trusts a forwarded chain only when it holds exactly one address
const FORWARDED_CHAIN = "198.51.100.7, 198.51.100.8";

// past the ceiling of any window the auth routes set
const ATTEMPT_CAP = 20;

const signInFrom = async (callerIp: string): Promise<Response> =>
  await SELF.fetch(`${ORIGIN}/api/auth/sign-in/email`, {
    body: JSON.stringify({ email: "nobody@example.test", password: "not-the-password" }),
    headers: {
      "content-type": "application/json",
      [CALLER_IP_HEADER]: callerIp,
      origin: ORIGIN,
      "x-forwarded-for": FORWARDED_CHAIN,
    },
    method: "POST",
  });

const spendSignInWindow = async (callerIp: string): Promise<void> => {
  for (let attempt = 0; attempt < ATTEMPT_CAP; attempt += 1) {
    const response = await signInFrom(callerIp);
    if (response.status === 429) {
      return;
    }
    expect(response.status).toBe(401);
  }
  throw new Error(`the sign-in window for ${callerIp} never shut`);
};

describe("Better Auth's limiter", () => {
  // the suite config keeps the limiter off so suites do not 429 on one another
  let wasDisabled = "";
  beforeEach(() => {
    wasDisabled = env.RATE_LIMIT_DISABLED;
    env.RATE_LIMIT_DISABLED = "false";
  });
  afterEach(() => {
    env.RATE_LIMIT_DISABLED = wasDisabled;
  });

  it("keys a sign-in on the edge's caller address, whatever x-forwarded-for carries", async () => {
    await spendSignInWindow("203.0.113.10");

    const other = await signInFrom("203.0.113.11");
    expect(other.status).toBe(401);
  });

  it("prunes the Worker's lapsed rows beside its own when one of its windows rolls over", async () => {
    const db = createDb(env.DB);
    const lapsed = Date.now() - 2 * AUTH_RATE_WINDOW_SECONDS * 1000;
    const workerKey = callerRateKey(
      "login",
      new Request(ORIGIN, { headers: { [CALLER_IP_HEADER]: "203.0.113.30" } }),
    );
    await db.insert(rateLimit).values([
      { count: 1, id: crypto.randomUUID(), key: workerKey, lastRequest: lapsed },
      {
        count: 1,
        id: crypto.randomUUID(),
        key: "203.0.113.31|/sign-in/email",
        lastRequest: lapsed,
      },
    ]);

    const rolledOver = await signInFrom("203.0.113.31");
    expect(rolledOver.status).toBe(401);

    await vi.waitFor(async () => {
      const rows = await db.select().from(rateLimit).where(eq(rateLimit.key, workerKey)).all();
      expect(rows).toEqual([]);
    });
  });

  it("never spends a window on a session read", async () => {
    for (let read = 0; read < ATTEMPT_CAP; read += 1) {
      const response = await SELF.fetch(`${ORIGIN}/api/auth/get-session`, {
        headers: { [CALLER_IP_HEADER]: "203.0.113.20", origin: ORIGIN },
      });
      expect(response.status).toBe(200);
    }
  });
});

describe("the Worker's windows on Better Auth's table", () => {
  it("never outlast Better Auth's own, whose prune would reset a longer one mid-count", () => {
    for (const [family, window] of Object.entries(RATE_WINDOWS)) {
      expect(
        window.windowMs,
        `RATE_WINDOWS.${family} in src/worker/rate-limit.ts is ${String(window.windowMs)}ms, past ` +
          `Better Auth's ${String(AUTH_RATE_WINDOW_SECONDS)}s: its prune drops a rate_limit row ` +
          "that old, so this window would reset early. Shorten it or give the Worker its own table.",
      ).toBeLessThanOrEqual(AUTH_RATE_WINDOW_SECONDS * 1000);
    }
  });
});
