import { randomUUID } from "node:crypto";

import { EXTENSION_ORIGIN } from "@repo/contract/extension/extension-identity";
import { PHONE_ORIGIN } from "@repo/contract/origin";
import { session } from "@repo/db/auth-schema";
import { db } from "@repo/db/drizzle-client";
import { dbSuite } from "@repo/db/test-database";
import { and, eq, gt } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  authPost,
  BROWSER_USER_AGENT,
  cookieHeaderOf,
  ORIGIN,
  PASSWORD,
  PHONE_USER_AGENT,
  sessionOf,
  sessionTokenOf,
  signInPhone,
  signUpUser,
  userIdOf,
} from "../test-support/auth-requests.test-utils";
import { issueToken } from "../test-support/password-reset.test-utils";
import { getAuth } from "./auth";
import {
  deviceNameOf,
  listSessionDevices,
  MAX_SESSIONS_PER_ACCOUNT,
  revokeSessionDevice,
} from "./session-devices";

const DAY_MS = 86_400_000;

const liveSessionsOf = async (userId: string) =>
  await db
    .select({ id: session.id, token: session.token })
    .from(session)
    .where(and(eq(session.userId, userId), gt(session.expiresAt, new Date())));

const extensionHeaders = (cookie: string) => ({
  authorization: `Bearer ${sessionTokenOf(cookie)}`,
});

const phoneHeaders = (cookie: string) => ({ cookie, "expo-origin": PHONE_ORIGIN });

const sessionIdOf = async (cookie: string) => {
  const found = await sessionOf({ cookie });

  if (found === null) {
    throw new Error("no session for that cookie");
  }

  return found.session.id;
};

const adapter = async () => {
  const context = await getAuth().$context;

  return context.internalAdapter;
};

dbSuite("Better Auth's routes for every device", () => {
  it("answers a sign-in with its cookie and no token a script could read", async () => {
    const email = "routes-token@example.test";
    await signUpUser(email);

    const callers: readonly Record<string, string>[] = [
      { origin: ORIGIN },
      { "expo-origin": PHONE_ORIGIN },
    ];

    for (const headers of callers) {
      const signedIn = await authPost("/sign-in/email", headers, { email, password: PASSWORD });
      expect(signedIn.status).toBe(200);
      expect(signedIn.headers.get("set-auth-token")).toBeNull();
      expect(signedIn.headers.get("access-control-expose-headers")).toBeNull();
      expect(cookieHeaderOf(signedIn)).toContain("session_token=");
    }
  });

  it("trusts the phone's origin, and no extension's", async () => {
    const email = "routes-origins@example.test";
    const { cookie } = await signUpUser(email);

    const refused = await authPost(
      "/sign-in/email",
      { origin: EXTENSION_ORIGIN },
      { email, password: PASSWORD },
    );

    expect(refused.status).toBe(403);
    const keptOut = await authPost("/sign-out", { cookie, origin: EXTENSION_ORIGIN });
    expect(keptOut.status).toBe(403);
    expect(keptOut.headers.get("clear-site-data")).toBeNull();
    const accountId = await userIdOf(cookie);
    await expect(liveSessionsOf(accountId)).resolves.toHaveLength(1);

    const signedOut = await authPost("/sign-out", { cookie, origin: ORIGIN });
    expect(signedOut.status).toBe(200);
    expect(signedOut.headers.get("clear-site-data")).toBe('"cache"');
    await expect(liveSessionsOf(accountId)).resolves.toHaveLength(0);

    const phone = await authPost(
      "/sign-in/email",
      { cookie: await signInPhone(email), "expo-origin": PHONE_ORIGIN },
      { email, password: PASSWORD },
    );

    expect(phone.status).toBe(200);
  });

  it("reads the extension's bearer as the browser's session", async () => {
    const { cookie } = await signUpUser("routes-bearer@example.test");
    const asBearer = await sessionOf(extensionHeaders(cookie));
    expect(asBearer?.user.email).toBe("routes-bearer@example.test");
  });

  it("keeps a sign-in sixty days", async () => {
    const { cookie } = await signUpUser("routes-sixty@example.test");

    const [row] = await db
      .select({ createdAt: session.createdAt, expiresAt: session.expiresAt })
      .from(session)
      .where(eq(session.userId, await userIdOf(cookie)));

    expect((row?.expiresAt.getTime() ?? 0) - (row?.createdAt.getTime() ?? 0)).toBeGreaterThan(
      59 * DAY_MS,
    );
  });

  it("signs every device out at a password reset, the phone and the extension included", async () => {
    const email = "routes-reset@example.test";
    const { cookie } = await signUpUser(email);
    const phoneCookie = await signInPhone(email);

    const reset = await authPost(
      "/reset-password",
      { origin: ORIGIN },
      { newPassword: "new-password-5678", token: await issueToken(email) },
    );

    expect(reset.status).toBe(200);
    await expect(sessionOf(phoneHeaders(phoneCookie))).resolves.toBeNull();
    await expect(sessionOf(extensionHeaders(cookie))).resolves.toBeNull();
    await expect(sessionOf({ cookie })).resolves.toBeNull();
  });
});

dbSuite("the account's devices, its sessions", () => {
  it("lists each by the device it signed in from, marks the one asking, and names no token", async () => {
    const email = "devices-list@example.test";
    const { cookie } = await signUpUser(email);
    const phoneCookie = await signInPhone(email);
    const accountId = await userIdOf(cookie);
    const devices = await listSessionDevices(accountId, await sessionIdOf(phoneCookie));
    expect(devices.map(({ current, name }) => ({ current, name }))).toStrictEqual([
      { current: false, name: "Chrome on Mac" },
      { current: true, name: "iPhone" },
    ]);

    for (const device of devices) {
      expect(Object.keys(device).toSorted()).toStrictEqual([
        "createdAt",
        "current",
        "id",
        "lastSeenAt",
        "name",
      ]);
    }

    const listed = JSON.stringify(devices);

    for (const { token } of await liveSessionsOf(accountId)) {
      expect(listed).not.toContain(token);
    }
  });

  it("ends one by its id, and its next read is refused", async () => {
    const email = "devices-revoke@example.test";
    const { cookie } = await signUpUser(email);
    const phoneCookie = await signInPhone(email);
    const accountId = await userIdOf(cookie);
    const listed = await listSessionDevices(accountId, await sessionIdOf(cookie));
    const phoneRow = listed.find(({ current }) => !current);

    if (phoneRow === undefined) {
      throw new Error("no phone session listed");
    }

    await expect(
      revokeSessionDevice(await adapter(), { id: phoneRow.id, userId: accountId }),
    ).resolves.toBe(true);
    await expect(sessionOf(phoneHeaders(phoneCookie))).resolves.toBeNull();
    const after = await listSessionDevices(accountId, await sessionIdOf(cookie));
    expect(after.map(({ id }) => id)).not.toContain(phoneRow.id);
  });

  it("ends no other account's session", async () => {
    const alice = await signUpUser("devices-alice@example.test");
    const mallory = await signUpUser("devices-mallory@example.test");
    const [alicesSession] = await liveSessionsOf(await userIdOf(alice.cookie));
    await expect(
      revokeSessionDevice(await adapter(), {
        id: alicesSession?.id ?? "",
        userId: await userIdOf(mallory.cookie),
      }),
    ).resolves.toBe(false);
    await expect(sessionOf({ cookie: alice.cookie })).resolves.not.toBeNull();
  });

  it("ends the longest unused at a sign-in past the cap", async () => {
    const email = "devices-cap@example.test";
    const { cookie } = await signUpUser(email);
    const accountId = await userIdOf(cookie);
    const now = Date.now();
    await db.insert(session).values(
      Array.from({ length: MAX_SESSIONS_PER_ACCOUNT - 1 }, (_, index) => ({
        createdAt: new Date(now + index + 1),
        expiresAt: new Date(now + DAY_MS),
        id: `cap-session-${String(index)}`,
        token: `cap-token-${String(index)}-${randomUUID()}`,
        updatedAt: new Date(now + index + 1),
        userAgent: BROWSER_USER_AGENT,
        userId: accountId,
      })),
    );
    await expect(liveSessionsOf(accountId)).resolves.toHaveLength(MAX_SESSIONS_PER_ACCOUNT);

    await signInPhone(email);
    const live = await liveSessionsOf(accountId);
    expect(live).toHaveLength(MAX_SESSIONS_PER_ACCOUNT);
    expect(live.map(({ id }) => id)).toContain("cap-session-0");
    await expect(sessionOf({ cookie })).resolves.toBeNull();
  });
});

describe("a session's name", () => {
  it("is read from the user agent it signed in with", () => {
    expect(deviceNameOf(PHONE_USER_AGENT)).toBe("iPhone");
    expect(deviceNameOf(BROWSER_USER_AGENT)).toBe("Chrome on Mac");
    expect(
      deviceNameOf(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)",
      ),
    ).toBe("Mac app");
    expect(
      deviceNameOf(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
      ),
    ).toBe("Safari on Mac");
    expect(
      deviceNameOf(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0",
      ),
    ).toBe("Edge on Windows");
    expect(
      deviceNameOf(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("Safari on iPhone");
    expect(deviceNameOf(null)).toBe("Unknown device");
  });
});
