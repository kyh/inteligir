import { randomUUID } from "node:crypto";

import { rateLimit } from "@repo/db/auth-schema";
import { db } from "@repo/db/drizzle-client";
import { dbSuite } from "@repo/db/test-database";
import { getIP } from "better-auth/api";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { AUTH_RATE_WINDOW_SECONDS, callerRateKey, RATE_WINDOWS } from "../rate-limit";
import {
  authFetch,
  authPost,
  CALLER_IP_HEADER,
  ORIGIN,
} from "../test-support/auth-requests.test-utils";
import { clientIpOptions } from "./client-ip";
import { OAUTH_REGISTER_WINDOW_SECONDS } from "./oauth";

const ATTEMPT_CAP = 20;

const AUTH_MAX = 10;
const SIGN_IN_MAX = 3;
const REGISTER_MAX = 10;

const signInFrom = async (callerIp: string) =>
  await authPost(
    "/sign-in/email",
    { [CALLER_IP_HEADER]: callerIp, origin: ORIGIN },
    { email: "nobody@example.test", password: "not-the-password" },
  );

const signOutFrom = async (callerIp: string) =>
  await authPost("/sign-out", { [CALLER_IP_HEADER]: callerIp, origin: ORIGIN });

const registerFrom = async (callerIp: string) =>
  await authFetch("/oauth2/register", {
    body: JSON.stringify({
      client_name: "Probe",
      redirect_uris: ["https://probe.example/callback"],
      token_endpoint_auth_method: "none",
    }),
    headers: { "content-type": "application/json", [CALLER_IP_HEADER]: callerIp },
    method: "POST",
  });

const statusesOf = async (times: number, call: () => Promise<Response>) => {
  const statuses = [];

  for (let attempt = 0; attempt < times; attempt += 1) {
    const response = await call();
    statuses.push(response.status);
  }

  return statuses;
};

dbSuite("Better Auth's limiter", () => {
  it("holds one address to 3 sign-ins in 10 s, and leaves another's open", async () => {
    await expect(
      statusesOf(SIGN_IN_MAX + 1, async () => await signInFrom("203.0.113.10")),
    ).resolves.toStrictEqual([...Array.from({ length: SIGN_IN_MAX }, () => 401), 429]);

    const other = await signInFrom("203.0.113.11");
    expect(other.status).toBe(401);
  });

  it("holds one address to 10 calls a minute on a route with no rule of its own", async () => {
    await expect(
      statusesOf(AUTH_MAX + 1, async () => await signOutFrom("203.0.113.12")),
    ).resolves.toStrictEqual([...Array.from({ length: AUTH_MAX }, () => 200), 429]);
  });

  it("holds one address to 10 assistants registered an hour", async () => {
    await expect(
      statusesOf(REGISTER_MAX + 1, async () => await registerFrom("203.0.113.20")),
    ).resolves.toStrictEqual([...Array.from({ length: REGISTER_MAX }, () => 201), 429]);
  });

  it("prunes the app's lapsed rows beside its own when one of its windows rolls over", async () => {
    const lapsed = Date.now() - 2 * OAUTH_REGISTER_WINDOW_SECONDS * 1000;

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
