import {
  ACCOUNT_API_PATHS,
  accountResponseSchema,
  AUTH_PAGE_PATHS,
} from "@repo/api/cloud/account/account-schema";
import type { DeviceSignUpRequest } from "@repo/api/cloud/account/account-schema";
import { cloudErrorSchema } from "@repo/api/cloud/errors";
import {
  DEVICE_API_PATHS,
  deviceLoginResponseSchema,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "@repo/api/cloud/device/device-schema";
import { eq } from "drizzle-orm";
import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deviceHeaders, emitted, ORIGIN, PASSWORD, signUpUser } from "./cloud-helpers";
import { createDb } from "../db/client";
import { device, inviteCode, session, user } from "../db/schema";
import { CALLER_IP_HEADER } from "../rate-limit";

// `POST /v1/device/sign-up` — the app's door to the invite gate: one request creates the account
// and answers this device's credential, the login's answer.

const mintCode = async (code: string): Promise<void> => {
  await createDb(env.DB).insert(inviteCode).values({ code });
};

const readCode = async (code: string) =>
  await createDb(env.DB).select().from(inviteCode).where(eq(inviteCode.code, code)).get();

const userByEmail = async (email: string) =>
  await createDb(env.DB).select().from(user).where(eq(user.email, email)).get();

const postSignUp = async (
  body: Partial<DeviceSignUpRequest>,
  headers: Record<string, string> = {},
): Promise<Response> =>
  await SELF.fetch(`${ORIGIN}${DEVICE_API_PATHS.signUp}`, {
    body: JSON.stringify(body),
    headers: { ...headers, "content-type": "application/json" },
    method: "POST",
  });

const postSiteSignUp = async (
  email: string,
  code: string,
  headers: Record<string, string> = {},
): Promise<Response> =>
  await SELF.fetch(`${ORIGIN}${AUTH_PAGE_PATHS.signUp}`, {
    body: JSON.stringify({ email, inviteCode: code, name: "Site Signup", password: PASSWORD }),
    headers: { ...headers, "content-type": "application/json", origin: ORIGIN },
    method: "POST",
  });

const request = (email: string, code: string): DeviceSignUpRequest => ({
  deviceName: "Test Laptop",
  email,
  inviteCode: code,
  name: "App Signup",
  password: PASSWORD,
});

const refusalCode = async (response: Response): Promise<string> =>
  emitted(cloudErrorSchema, await response.text()).error.code;

describe("device sign-up", () => {
  it("creates the account and answers a credential that names it, with no session left behind", async () => {
    await mintCode("APP-INVITE-OK");
    const response = await postSignUp(request("  App-OK@Example.TEST ", "APP-INVITE-OK"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-auth-token")).toBeNull();
    const signedUp = emitted(deviceLoginResponseSchema, await response.text());

    const account = await SELF.fetch(`${ORIGIN}${ACCOUNT_API_PATHS.account}`, {
      headers: deviceHeaders(signedUp.credential),
    });
    expect(account.status).toBe(200);
    const answered = emitted(accountResponseSchema, await account.text());
    expect(answered.email).toBe("app-ok@example.test");

    const db = createDb(env.DB);
    const sessions = await db.select().from(session).where(eq(session.userId, answered.id)).all();
    expect(sessions).toEqual([]);
    const row = await db.select().from(device).where(eq(device.id, signedUp.deviceId)).get();
    expect(row?.name).toBe("Test Laptop");
    expect(row?.userId).toBe(answered.id);

    const code = await readCode("APP-INVITE-OK");
    expect(code?.redeemedAt).not.toBeNull();
    expect(code?.redeemedBy).toBe("app-ok@example.test");
  });

  it("refuses an unknown code as invite-refused and creates no account", async () => {
    const response = await postSignUp(request("app-unknown@example.test", "NO-SUCH-CODE"));
    expect(response.status).toBe(403);
    expect(await refusalCode(response)).toBe("invite-refused");
    expect(await userByEmail("app-unknown@example.test")).toBeUndefined();
  });

  it("spends a code once, whichever door redeemed it", async () => {
    await mintCode("APP-INVITE-ONCE");
    const first = await postSignUp(request("app-first@example.test", "APP-INVITE-ONCE"));
    expect(first.status).toBe(200);
    const again = await postSignUp(request("app-again@example.test", "APP-INVITE-ONCE"));
    expect(again.status).toBe(403);
    expect(await refusalCode(again)).toBe("invite-refused");
    expect(await userByEmail("app-again@example.test")).toBeUndefined();
    const site = await postSiteSignUp("site-after-app@example.test", "APP-INVITE-ONCE");
    expect(site.status).toBe(403);

    await mintCode("SITE-INVITE-ONCE");
    const onSite = await postSiteSignUp("site-first@example.test", "SITE-INVITE-ONCE");
    expect(onSite.status).toBe(200);
    const inApp = await postSignUp(request("app-after-site@example.test", "SITE-INVITE-ONCE"));
    expect(inApp.status).toBe(403);
    expect(await refusalCode(inApp)).toBe("invite-refused");
    expect(await userByEmail("app-after-site@example.test")).toBeUndefined();
  });

  it("refuses an address that already has an account, and gives the code back", async () => {
    await signUpUser("app-taken@example.test");
    await mintCode("APP-INVITE-TAKEN");
    const response = await postSignUp(request("App-Taken@example.test", "APP-INVITE-TAKEN"));
    expect(response.status).toBe(409);
    expect(await refusalCode(response)).toBe("account-exists");

    const released = await readCode("APP-INVITE-TAKEN");
    expect(released?.redeemedAt).toBeNull();
    expect(released?.redeemedBy).toBeNull();
    const reused = await postSignUp(request("app-fresh@example.test", "APP-INVITE-TAKEN"));
    expect(reused.status).toBe(200);
  });

  it("refuses a password outside the contract's bounds before touching the invite", async () => {
    await mintCode("APP-INVITE-BOUNDS");
    for (const password of [
      "x".repeat(PASSWORD_MIN_LENGTH - 1),
      "x".repeat(PASSWORD_MAX_LENGTH + 1),
    ]) {
      const response = await postSignUp({
        ...request("app-bounds@example.test", "APP-INVITE-BOUNDS"),
        password,
      });
      expect(response.status, String(password.length)).toBe(400);
      const refusal = emitted(cloudErrorSchema, await response.text()).error;
      expect(refusal.code).toBe("bad-request");
      expect(refusal.message).toBe(
        `Use a password of ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters.`,
      );
    }
    const untouched = await readCode("APP-INVITE-BOUNDS");
    expect(untouched?.redeemedAt).toBeNull();
    expect(await userByEmail("app-bounds@example.test")).toBeUndefined();
  });

  it("refuses a body with no device name before touching the invite", async () => {
    await mintCode("APP-INVITE-SHAPE");
    const response = await postSignUp({
      email: "app-shape@example.test",
      inviteCode: "APP-INVITE-SHAPE",
      name: "Unnamed Device",
      password: PASSWORD,
    });
    expect(response.status).toBe(400);
    expect(await refusalCode(response)).toBe("bad-request");
    const untouched = await readCode("APP-INVITE-SHAPE");
    expect(untouched?.redeemedAt).toBeNull();
  });
});

describe("the invite gate's window", () => {
  // the suite config keeps the limiter off so suites do not 429 on one another
  let wasDisabled = "";
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
      const site = await postSiteSignUp("window@example.test", "NOT-A-CODE", caller);
      expect(site.status).toBe(403);
      const app = await postSignUp(request("window@example.test", "NOT-A-CODE"), caller);
      expect(app.status).toBe(403);
    }
    await mintCode("APP-INVITE-WINDOW");
    const shut = await postSignUp(request("window@example.test", "APP-INVITE-WINDOW"), caller);
    expect(shut.status).toBe(429);
    expect(await refusalCode(shut)).toBe("rate-limited");
    const untouched = await readCode("APP-INVITE-WINDOW");
    expect(untouched?.redeemedAt).toBeNull();
  });
});
