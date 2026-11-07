// `account.signUp`, the app's door to the invite gate: one call creates the account and answers
// this device's credential, as a sign-in answers it.

import { AUTH_API_PATHS } from "@repo/contract/cloud/account/account-schema";
import type { DeviceSignUpRequest } from "@repo/contract/cloud/account/account-schema";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "@repo/contract/cloud/device/device-schema";
import { V1_RPC_PATH } from "@repo/contract/cloud/v1";
import { eq } from "drizzle-orm";
import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildHeaders,
  drained,
  ORIGIN,
  OWN_PAGE_HEADERS,
  PASSWORD,
  signUpUser,
  v1Link,
} from "./test-support/cloud-helpers";
import { createDb } from "./db/client";
import { device, inviteCode, session, user } from "./db/schema";
import { CALLER_IP_HEADER } from "./rate-limit";

const mintCode = async (code: string): Promise<void> => {
  await createDb(env.DB).insert(inviteCode).values({ code });
};

const readCode = async (code: string) =>
  await createDb(env.DB).select().from(inviteCode).where(eq(inviteCode.code, code)).get();

const userByEmail = async (email: string) =>
  await createDb(env.DB).select().from(user).where(eq(user.email, email)).get();

// an app with no credential yet, from the caller address the gate's window counts
const appFrom = (headers: Record<string, string> = {}) => v1Link({ ...buildHeaders(), ...headers });

const refusalOfSignUp = async (body: DeviceSignUpRequest, headers: Record<string, string> = {}) => {
  const app = appFrom(headers);
  return await app.refusalOf(app.account.signUp(body));
};

const postSiteSignUp = async (
  email: string,
  code: string,
  headers: Record<string, string> = {},
): Promise<Response> =>
  await exports.default.fetch(`${ORIGIN}${AUTH_API_PATHS.signUp}`, {
    body: JSON.stringify({ email, inviteCode: code, name: "Site Signup", password: PASSWORD }),
    headers: { ...OWN_PAGE_HEADERS, ...headers, "content-type": "application/json" },
    method: "POST",
  });

const request = (email: string, code: string): DeviceSignUpRequest => ({
  deviceName: "Test Laptop",
  email,
  inviteCode: code,
  name: "App Signup",
  password: PASSWORD,
});

const INVITE_REFUSED = { code: "FORBIDDEN", defined: true, status: 403 };

describe("device sign-up", () => {
  it("creates the account and answers a credential that names it, with no session left behind", async () => {
    await mintCode("APP-INVITE-OK");
    const app = appFrom();
    const signedUp = await app.account.signUp(request("  App-OK@Example.TEST ", "APP-INVITE-OK"));
    expect(app.setCookies).toStrictEqual([[]]);
    expect(signedUp.email).toBe("app-ok@example.test");
    const account = await userByEmail("app-ok@example.test");
    expect(account?.id).toBe(signedUp.userId);

    const db = createDb(env.DB);
    const sessions = await db
      .select()
      .from(session)
      .where(eq(session.userId, signedUp.userId))
      .all();
    expect(sessions).toStrictEqual([]);
    const row = await db.select().from(device).where(eq(device.id, signedUp.deviceId)).get();
    expect(row?.name).toBe("Test Laptop");
    expect(row?.userId).toBe(signedUp.userId);

    const code = await readCode("APP-INVITE-OK");
    expect(code?.redeemedAt).not.toBeNull();
    expect(code?.redeemedBy).toBe("app-ok@example.test");
  });

  it("refuses an unknown code and creates no account", async () => {
    await expect(
      refusalOfSignUp(request("app-unknown@example.test", "NO-SUCH-CODE")),
    ).resolves.toMatchObject(INVITE_REFUSED);
    await expect(userByEmail("app-unknown@example.test")).resolves.toBeUndefined();
  });

  it("spends a code once, whichever door redeemed it", async () => {
    await mintCode("APP-INVITE-ONCE");
    await appFrom().account.signUp(request("app-first@example.test", "APP-INVITE-ONCE"));
    await expect(
      refusalOfSignUp(request("app-again@example.test", "APP-INVITE-ONCE")),
    ).resolves.toMatchObject(INVITE_REFUSED);
    await expect(userByEmail("app-again@example.test")).resolves.toBeUndefined();
    const site = await drained(postSiteSignUp("site-after-app@example.test", "APP-INVITE-ONCE"));
    expect(site.status).toBe(403);

    await mintCode("SITE-INVITE-ONCE");
    const onSite = await drained(postSiteSignUp("site-first@example.test", "SITE-INVITE-ONCE"));
    expect(onSite.status).toBe(200);
    await expect(
      refusalOfSignUp(request("app-after-site@example.test", "SITE-INVITE-ONCE")),
    ).resolves.toMatchObject(INVITE_REFUSED);
    await expect(userByEmail("app-after-site@example.test")).resolves.toBeUndefined();
  });

  it("refuses an address that already has an account, and gives the code back", async () => {
    await signUpUser("app-taken@example.test");
    await mintCode("APP-INVITE-TAKEN");
    await expect(
      refusalOfSignUp(request("App-Taken@example.test", "APP-INVITE-TAKEN")),
    ).resolves.toMatchObject({ code: "ACCOUNT_EXISTS", defined: true, status: 409 });

    const released = await readCode("APP-INVITE-TAKEN");
    expect(released?.redeemedAt).toBeNull();
    expect(released?.redeemedBy).toBeNull();
    const reused = await appFrom().account.signUp(
      request("app-fresh@example.test", "APP-INVITE-TAKEN"),
    );
    expect(reused.email).toBe("app-fresh@example.test");
  });

  it("refuses a password outside the contract's bounds before touching the invite", async () => {
    await mintCode("APP-INVITE-BOUNDS");
    for (const password of [
      "x".repeat(PASSWORD_MIN_LENGTH - 1),
      "x".repeat(PASSWORD_MAX_LENGTH + 1),
    ]) {
      await expect(
        refusalOfSignUp({
          ...request("app-bounds@example.test", "APP-INVITE-BOUNDS"),
          password,
        }),
      ).resolves.toMatchObject({ code: "BAD_REQUEST", status: 400 });
    }
    const untouched = await readCode("APP-INVITE-BOUNDS");
    expect(untouched?.redeemedAt).toBeNull();
    await expect(userByEmail("app-bounds@example.test")).resolves.toBeUndefined();
  });

  it("refuses a body with no device name before touching the invite", async () => {
    await mintCode("APP-INVITE-SHAPE");
    // the RPC protocol's own body, the device's name left out
    const response = await drained(
      exports.default.fetch(`${ORIGIN}${V1_RPC_PATH}/account/signUp`, {
        body: JSON.stringify({
          json: {
            email: "app-shape@example.test",
            inviteCode: "APP-INVITE-SHAPE",
            name: "Unnamed Device",
            password: PASSWORD,
          },
        }),
        headers: { ...buildHeaders(), "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(400);
    const untouched = await readCode("APP-INVITE-SHAPE");
    expect(untouched?.redeemedAt).toBeNull();
  });
});

describe("the invite gate's window", () => {
  // the suite config keeps the limiter off so suites do not 429 on one another
  let wasDisabled: Env["RATE_LIMIT_DISABLED"] = "true";
  beforeEach(() => {
    wasDisabled = env.RATE_LIMIT_DISABLED;
    env.RATE_LIMIT_DISABLED = "false";
  });
  afterEach(() => {
    env.RATE_LIMIT_DISABLED = wasDisabled;
  });

  it("closes on the eleventh attempt from one address, whichever door each came through", async () => {
    const caller = { [CALLER_IP_HEADER]: "203.0.113.77" };
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const site = await drained(postSiteSignUp("window@example.test", "NOT-A-CODE", caller));
      expect(site.status).toBe(403);
      await expect(
        refusalOfSignUp(request("window@example.test", "NOT-A-CODE"), caller),
      ).resolves.toMatchObject(INVITE_REFUSED);
    }
    await mintCode("APP-INVITE-WINDOW");
    await expect(
      refusalOfSignUp(request("window@example.test", "APP-INVITE-WINDOW"), caller),
    ).resolves.toMatchObject({ code: "TOO_MANY_REQUESTS", defined: true, status: 429 });
    const untouched = await readCode("APP-INVITE-WINDOW");
    expect(untouched?.redeemedAt).toBeNull();
  });
});
