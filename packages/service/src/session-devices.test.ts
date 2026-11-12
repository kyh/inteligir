// Every device signed in by Better Auth's own session: the routes it signs in and out on, the
// devices it lists and ends, and the cap a new sign-in keeps the account under. The door each one
// reaches `/v1` by is `wire/v1-rpc.test.ts`'s.

import { EXTENSION_ORIGIN } from "@repo/contract/extension/extension-identity";
import { SOCKET_REVOKED_CLOSE_CODE } from "@repo/contract/library/library-socket";
import { PHONE_ORIGIN } from "@repo/contract/origin";
import { env, exports } from "cloudflare:workers";
import { and, eq, gt } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { deviceNameOf, MAX_SESSIONS_PER_ACCOUNT } from "./auth/session-devices";
import { createDb } from "@repo/db/d1/client";
import { session } from "@repo/db/d1/schema";
import {
  BROWSER_USER_AGENT,
  cookieHeaderOf,
  drained,
  extensionHeaders,
  openSocketAs,
  ORIGIN,
  PASSWORD,
  phoneHeaders,
  PHONE_USER_AGENT,
  sessionHeaders,
  signInPhone,
  signUpUser,
  userIdOf,
  v1Link,
} from "./test-support/cloud-helpers";
import { issueToken } from "./test-support/password-reset";

const DAY_MS = 86_400_000;
const UNAUTHORIZED = { code: "UNAUTHORIZED", status: 401 } as const;

// the close a socket meets, as a promise a test can await
const closeOf = async (socket: WebSocket): Promise<number> =>
  // oxlint-disable-next-line promise/avoid-new -- a socket's close arrives as an event, which only a promise can hand to an await
  await new Promise<number>((resolve) => {
    socket.addEventListener("close", (close) => {
      resolve(close.code);
    });
  });

const liveSessionsOf = async (userId: string) =>
  await createDb(env.DB)
    .select({ id: session.id, token: session.token })
    .from(session)
    .where(and(eq(session.userId, userId), gt(session.expiresAt, new Date())))
    .all();

const authPost = async (
  path: string,
  headers: Record<string, string>,
  body: Record<string, string> = {},
) =>
  await drained(
    exports.default.fetch(`${ORIGIN}/api/auth${path}`, {
      body: JSON.stringify(body),
      headers: { ...headers, "content-type": "application/json" },
      method: "POST",
    }),
  );

describe("Better Auth's routes for every device", () => {
  it("answers a sign-in with its cookie and no token a script could read", async () => {
    const email = "routes-token@example.test";
    await signUpUser(email);
    const callers: readonly Record<string, string>[] = [
      { origin: ORIGIN },
      { "expo-origin": PHONE_ORIGIN },
      { origin: EXTENSION_ORIGIN },
    ];
    for (const headers of callers) {
      const signedIn = await authPost("/sign-in/email", headers, { email, password: PASSWORD });
      expect(signedIn.status).toBe(200);
      expect(signedIn.headers.get("set-auth-token")).toBeNull();
      expect(signedIn.headers.get("access-control-expose-headers")).toBeNull();
      expect(cookieHeaderOf(signedIn)).toContain("session_token=");
    }
  });

  it("trusts the extension's and the phone's origins, and no other extension's", async () => {
    const email = "routes-origins@example.test";
    const { cookie } = await signUpUser(email);
    const other = "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const refused = await authPost(
      "/sign-in/email",
      { origin: other },
      { email, password: PASSWORD },
    );
    expect(refused.status).toBe(403);
    const keptOut = await authPost("/sign-out", { cookie, origin: other });
    expect(keptOut.status).toBe(403);
    expect(keptOut.headers.get("clear-site-data")).toBeNull();
    const accountId = await userIdOf(cookie);
    await expect(liveSessionsOf(accountId)).resolves.toHaveLength(1);

    const signedOut = await authPost("/sign-out", { cookie, origin: EXTENSION_ORIGIN });
    expect(signedOut.status).toBe(200);
    await expect(liveSessionsOf(accountId)).resolves.toHaveLength(0);
    // a native request names no Origin, so the phone's plugin reads its scheme in its place
    const phone = await authPost(
      "/sign-in/email",
      { cookie: await signInPhone(email), "expo-origin": PHONE_ORIGIN },
      { email, password: PASSWORD },
    );
    expect(phone.status).toBe(200);
  });

  it("keeps a sign-in sixty days", async () => {
    const { cookie } = await signUpUser("routes-sixty@example.test");
    const [row] = await createDb(env.DB)
      .select({ createdAt: session.createdAt, expiresAt: session.expiresAt })
      .from(session)
      .where(eq(session.userId, await userIdOf(cookie)))
      .all();
    expect((row?.expiresAt.getTime() ?? 0) - (row?.createdAt.getTime() ?? 0)).toBeGreaterThan(
      59 * DAY_MS,
    );
  });

  it("signs every device out at a password reset, the phone included", async () => {
    const email = "routes-reset@example.test";
    const { cookie } = await signUpUser(email);
    const phone = v1Link(phoneHeaders(await signInPhone(email)));
    const opened = await openSocketAs(phoneHeaders(await signInPhone(email)));
    const closed = closeOf(opened.socket);
    const reset = await authPost(
      "/reset-password",
      { origin: ORIGIN },
      { newPassword: "new-password-5678", token: await issueToken(email) },
    );
    expect(reset.status).toBe(200);
    await expect(phone.refusalOf(phone.account.devices.list())).resolves.toMatchObject(
      UNAUTHORIZED,
    );
    const extension = v1Link(extensionHeaders(cookie));
    await expect(extension.refusalOf(extension.account.devices.list())).resolves.toMatchObject(
      UNAUTHORIZED,
    );
    await expect(closed).resolves.toBe(SOCKET_REVOKED_CLOSE_CODE);
  });
});

describe("the account's devices, its sessions", () => {
  it("lists each by the device it signed in from, marks the one asking, and names no token", async () => {
    const email = "devices-list@example.test";
    const { cookie } = await signUpUser(email);
    const phoneCookie = await signInPhone(email);
    const { devices } = await v1Link(phoneHeaders(phoneCookie)).account.devices.list();
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
    for (const { token } of await liveSessionsOf(await userIdOf(cookie))) {
      expect(listed).not.toContain(token);
    }
  });

  it("ends one by its id: its next call is refused and its socket closes", async () => {
    const email = "devices-revoke@example.test";
    const { cookie } = await signUpUser(email);
    const phoneCookie = await signInPhone(email);
    const opened = await openSocketAs(phoneHeaders(phoneCookie));
    const closed = closeOf(opened.socket);
    const tab = v1Link(sessionHeaders(cookie));
    const listed = await tab.account.devices.list();
    const phoneRow = listed.devices.find(({ current }) => !current);
    await expect(tab.account.devices.revoke({ id: phoneRow?.id ?? "" })).resolves.toStrictEqual({
      revoked: true,
    });
    const phone = v1Link(phoneHeaders(phoneCookie));
    await expect(phone.refusalOf(phone.account.devices.list())).resolves.toMatchObject(
      UNAUTHORIZED,
    );
    await expect(closed).resolves.toBe(SOCKET_REVOKED_CLOSE_CODE);
    const { devices } = await tab.account.devices.list();
    expect(devices.map(({ id }) => id)).not.toContain(phoneRow?.id);
  });

  it("ends no other account's session", async () => {
    const alice = await signUpUser("devices-alice@example.test");
    const mallory = await signUpUser("devices-mallory@example.test");
    const [alicesSession] = await liveSessionsOf(await userIdOf(alice.cookie));
    const link = v1Link(sessionHeaders(mallory.cookie));
    await expect(
      link.refusalOf(link.account.devices.revoke({ id: alicesSession?.id ?? "" })),
    ).resolves.toMatchObject({ code: "NOT_FOUND", defined: true, status: 404 });
    await expect(
      v1Link(sessionHeaders(alice.cookie)).account.devices.list(),
    ).resolves.toBeDefined();
  });

  it("ends the longest unused at a sign-in past the cap, its socket with it", async () => {
    const email = "devices-cap@example.test";
    const { cookie } = await signUpUser(email);
    const accountId = await userIdOf(cookie);
    const opened = await openSocketAs(sessionHeaders(cookie));
    const closed = closeOf(opened.socket);
    const now = Date.now();
    // a row a statement, since D1 binds at most 100 values to one
    await Promise.all(
      Array.from({ length: MAX_SESSIONS_PER_ACCOUNT - 1 }, async (_, index) => {
        await createDb(env.DB)
          .insert(session)
          .values({
            createdAt: new Date(now + index + 1),
            expiresAt: new Date(now + DAY_MS),
            id: `cap-session-${String(index)}`,
            token: `cap-token-${String(index)}-${crypto.randomUUID()}`,
            updatedAt: new Date(now + index + 1),
            userAgent: BROWSER_USER_AGENT,
            userId: accountId,
          });
      }),
    );
    await expect(liveSessionsOf(accountId)).resolves.toHaveLength(MAX_SESSIONS_PER_ACCOUNT);

    await signInPhone(email);
    const live = await liveSessionsOf(accountId);
    expect(live).toHaveLength(MAX_SESSIONS_PER_ACCOUNT);
    expect(live.map(({ id }) => id)).toContain("cap-session-0");
    await expect(closed).resolves.toBe(SOCKET_REVOKED_CLOSE_CODE);
    const tab = v1Link(sessionHeaders(cookie));
    await expect(tab.refusalOf(tab.account.devices.list())).resolves.toMatchObject(UNAUTHORIZED);
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
