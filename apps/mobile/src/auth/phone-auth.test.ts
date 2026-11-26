import { createAuthClient } from "better-auth/client";
import type { BetterAuthClientPlugin } from "better-auth/client";
import { emailOTPClient } from "better-auth/client/plugins";
import type { JsonValue } from "@repo/contract/library/canonical-json";
import { describe, expect, it } from "vitest";
import { deferred } from "@repo/contract/deferred";
import { phoneAuthOver } from "./phone-auth";

const CLOUD = "https://cloud.test";
const SESSION = "better-auth.session_token=signed";

type Answer = () => Promise<Response>;

const json = (status: number, body: JsonValue) =>
  (async () => await Promise.resolve(Response.json(body, { status }))) satisfies Answer;

const phoneOver = (answers: Record<string, Answer>) => {
  const jar = { cookie: SESSION };
  const asked: { path: string; body: string | null }[] = [];

  const keychain = {
    fetchPlugins: [
      {
        id: "keychain",
        init: async (url: string, options) => {
          if (url.endsWith("/sign-out")) {
            jar.cookie = "";
          }

          return await Promise.resolve({ options, url });
        },
        name: "keychain",
      },
    ],
    getActions: () => ({ getCookie: async () => await Promise.resolve(jar.cookie) }),
    id: "keychain",
  } satisfies BetterAuthClientPlugin;

  const client = createAuthClient({
    baseURL: CLOUD,
    fetchOptions: {
      customFetchImpl: async (input, init) => {
        const request = new Request(input, init);
        const { pathname } = new URL(request.url);
        asked.push({ body: request.body === null ? null : await request.text(), path: pathname });
        const answer = answers[pathname];

        if (answer === undefined) {
          throw new TypeError(`nothing answers ${pathname}`);
        }

        return await answer();
      },
    },
    plugins: [emailOTPClient(), keychain],
  });

  return { asked, auth: phoneAuthOver(client, CLOUD), jar };
};

const unreachable: Answer = async () => {
  await Promise.resolve();
  throw new TypeError("the network is down");
};

describe("the phone's sign-in over Better Auth's client", () => {
  it("is signed in on the cloud's yes, refused with its status, code and sentence, and unreachable on no answer", async () => {
    const yes = phoneOver({ "/api/auth/sign-in/email-otp": json(200, { token: "t", user: {} }) });
    await expect(
      yes.auth.signIn({ code: "123456", email: "ada@example.com" }),
    ).resolves.toStrictEqual({ kind: "accepted" });
    expect(yes.asked).toStrictEqual([
      {
        body: JSON.stringify({ email: "ada@example.com", otp: "123456" }),
        path: "/api/auth/sign-in/email-otp",
      },
    ]);

    const no = phoneOver({
      "/api/auth/sign-in/email-otp": json(400, { code: "INVALID_OTP", message: "Invalid OTP" }),
    });

    await expect(
      no.auth.signIn({ code: "123456", email: "ada@example.com" }),
    ).resolves.toStrictEqual({
      code: "INVALID_OTP",
      kind: "refused",
      message: "Invalid OTP",
      status: 400,
    });

    const away = phoneOver({ "/api/auth/sign-in/email-otp": unreachable });
    await expect(
      away.auth.signIn({ code: "123456", email: "ada@example.com" }),
    ).resolves.toStrictEqual({ kind: "unreachable" });
  });

  it("asks Better Auth for a sign-in code", async () => {
    const phone = phoneOver({
      "/api/auth/email-otp/send-verification-otp": json(200, { success: true }),
    });

    await expect(phone.auth.sendSignInCode("ada@example.com")).resolves.toStrictEqual({
      kind: "accepted",
    });
    expect(phone.asked).toStrictEqual([
      {
        body: JSON.stringify({ email: "ada@example.com", type: "sign-in" }),
        path: "/api/auth/email-otp/send-verification-otp",
      },
    ]);
  });

  it("makes an account through the invite gate, beside Better Auth's own routes", async () => {
    const asking = { email: "ada@example.com", inviteCode: "INVITE-1" };
    const request = { ...asking, code: "123456", name: "Ada" };

    const gate = phoneOver({
      "/api/sign-up": json(400, { message: "That code didn't work. Check it, or send a new one." }),
      "/api/sign-up/code": json(403, { message: "That invite code doesn't work." }),
    });

    await expect(gate.auth.sendSignUpCode(asking)).resolves.toStrictEqual({
      code: null,
      kind: "refused",
      message: "That invite code doesn't work.",
      status: 403,
    });
    await expect(gate.auth.signUp(request)).resolves.toStrictEqual({
      code: null,
      kind: "refused",
      message: "That code didn't work. Check it, or send a new one.",
      status: 400,
    });
    expect(gate.asked).toStrictEqual([
      { body: JSON.stringify(asking), path: "/api/sign-up/code" },
      { body: JSON.stringify(request), path: "/api/sign-up" },
    ]);
  });

  it("reads the kept session, and none once it is gone", async () => {
    const phone = phoneOver({});
    await expect(phone.auth.cookie()).resolves.toBe(SESSION);
    phone.jar.cookie = "";
    await expect(phone.auth.cookie()).resolves.toBeNull();
  });

  it.each([
    ["live", json(200, { session: { id: "s1" }, user: { id: "u1" } })],
    ["ended", json(200, null)],
    ["unknown", json(500, { message: "internal error" })],
    ["unknown", unreachable],
  ])("checks the session as %s", async (checked, answer) => {
    const phone = phoneOver({ "/api/auth/get-session": answer });
    await expect(phone.auth.check()).resolves.toBe(checked);
  });

  it("signs out once the kept session is gone, though the cloud never answers", async () => {
    const never = deferred<Response>();
    const phone = phoneOver({ "/api/auth/sign-out": async () => await never.promise });
    await phone.auth.signOut();
    expect(phone.jar.cookie).toBe("");
    await expect
      .poll(() => phone.asked.map(({ path }) => path))
      .toStrictEqual(["/api/auth/sign-out"]);
  });

  it("signs out offline all the same", async () => {
    const phone = phoneOver({ "/api/auth/sign-out": unreachable });
    await phone.auth.signOut();
    await expect(phone.auth.cookie()).resolves.toBeNull();
  });
});
