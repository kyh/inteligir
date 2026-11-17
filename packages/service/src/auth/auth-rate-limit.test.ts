import { randomUUID } from "node:crypto";

import { rateLimit } from "@repo/db/auth-schema";
import { db } from "@repo/db/drizzle-client";
import { dbSuite } from "@repo/db/test-database";
import { getIP } from "better-auth/api";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { AUTH_RATE_WINDOW_SECONDS, callerRateKey, RATE_WINDOWS } from "../rate-limit";
import { authFetch, authPost, CALLER_IP_HEADER, ORIGIN } from "../test-support/auth-requests";
import { clientIpOptions } from "./client-ip";

// past the ceiling of any window the auth routes set
const ATTEMPT_CAP = 20;

const signInFrom = async (callerIp: string): Promise<Response> =>
  await authPost(
    "/sign-in/email",
    { [CALLER_IP_HEADER]: callerIp, origin: ORIGIN },
    { email: "nobody@example.test", password: "not-the-password" },
  );

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

dbSuite("Better Auth's limiter", () => {
  it("shuts one address's sign-in window and leaves another's open", async () => {
    await spendSignInWindow("203.0.113.10");

    const other = await signInFrom("203.0.113.11");
    expect(other.status).toBe(401);
  });

  it("prunes the app's lapsed rows beside its own when one of its windows rolls over", async () => {
    const lapsed = Date.now() - 2 * AUTH_RATE_WINDOW_SECONDS * 1000;
    const appKey = callerRateKey(
      "inviteSignUp",
      new Request(ORIGIN, { headers: { [CALLER_IP_HEADER]: "203.0.113.30" } }),
    );
    await db.insert(rateLimit).values([
      { count: 1, id: randomUUID(), key: appKey, lastRequest: lapsed },
      { count: 1, id: randomUUID(), key: "203.0.113.31|/sign-in/email", lastRequest: lapsed },
    ]);

    const rolledOver = await signInFrom("203.0.113.31");
    expect(rolledOver.status).toBe(401);

    await vi.waitFor(async () => {
      const rows = await db.select().from(rateLimit).where(eq(rateLimit.key, appKey));
      expect(rows).toStrictEqual([]);
    });
  });

  it("never spends a window on a session read", async () => {
    for (let read = 0; read < ATTEMPT_CAP; read += 1) {
      const response = await authFetch("/get-session", {
        headers: { [CALLER_IP_HEADER]: "203.0.113.20", origin: ORIGIN },
      });
      expect(response.status).toBe(200);
    }
  });
});

describe("the app's windows on Better Auth's table", () => {
  it("never outlast Better Auth's own, whose prune would reset a longer one mid-count", () => {
    for (const [family, window] of Object.entries(RATE_WINDOWS)) {
      expect(
        window.windowMs,
        `RATE_WINDOWS.${family} in src/rate-limit.ts is ${String(window.windowMs)}ms, past ` +
          `Better Auth's ${String(AUTH_RATE_WINDOW_SECONDS)}s: its prune drops a rate_limit row ` +
          "that old, so this window would reset early. Shorten it or give the app its own table.",
      ).toBeLessThanOrEqual(AUTH_RATE_WINDOW_SECONDS * 1000);
    }
  });
});

describe("the caller's address on Vercel", () => {
  const onVercel = { advanced: { ipAddress: clientIpOptions(true) } };

  it("is the one Vercel's edge sets, whatever x-forwarded-for carries", () => {
    const request = new Request(ORIGIN, {
      headers: {
        "x-forwarded-for": "198.51.100.7, 198.51.100.8",
        "x-vercel-forwarded-for": "203.0.113.40",
      },
    });
    expect(getIP(request, onVercel)).toBe("203.0.113.40");
  });

  it("falls back to x-forwarded-for, which Vercel overwrites with the caller's", () => {
    const request = new Request(ORIGIN, { headers: { "x-forwarded-for": "203.0.113.41" } });
    expect(getIP(request, onVercel)).toBe("203.0.113.41");
  });
});
