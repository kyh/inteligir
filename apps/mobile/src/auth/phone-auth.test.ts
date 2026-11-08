// The phone's auth over Better Auth's own client, as the app makes it but for the Expo plugin, whose
// part here is a jar standing in for the Keychain: what each of the cloud's answers comes to, and a
// sign-out that settles before the cloud answers it.

import { createAuthClient } from "better-auth/client";
import type { BetterAuthClientPlugin } from "better-auth/client";
import type { JsonValue } from "@repo/notes/library/canonical-json";
import { describe, expect, it } from "vitest";
import { deferred } from "../test-support/async";
import { phoneAuthOver } from "./phone-auth";

const CLOUD = "https://cloud.test";
const SESSION = "better-auth.session_token=signed";

type Answer = () => Promise<Response>;

const json =
  (status: number, body: JsonValue): Answer =>
  async () =>
    await Promise.resolve(Response.json(body, { status }));

// the cloud as the client meets it, each path's answer the suite's, and each request it was asked
const phoneOver = (answers: Record<string, Answer>) => {
  const jar = { cookie: SESSION };
  const asked: { path: string; body: string | null }[] = [];
  // the Expo plugin's part: the session it keeps, cleared before a sign-out's request goes
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
    plugins: [keychain],
  });
  return { asked, auth: phoneAuthOver(client, CLOUD), jar };
};

const unreachable: Answer = async () => {
  await Promise.resolve();
  throw new TypeError("the network is down");
};

describe("the phone's sign-in over Better Auth's client", () => {
  it("is signed in on the cloud's yes, refused with its status and sentence, and unreachable on no answer", async () => {
    const yes = phoneOver({ "/api/auth/sign-in/email": json(200, { token: "t", user: {} }) });
    await expect(
      yes.auth.signIn({ email: "ada@example.com", password: "pw" }),
    ).resolves.toStrictEqual({
      kind: "signed-in",
    });
    expect(yes.asked).toStrictEqual([
      {
        body: JSON.stringify({ email: "ada@example.com", password: "pw" }),
        path: "/api/auth/sign-in/email",
      },
    ]);

    const no = phoneOver({
      "/api/auth/sign-in/email": json(401, {
        code: "INVALID_EMAIL_OR_PASSWORD",
        message: "Invalid email or password",
      }),
    });
    await expect(
      no.auth.signIn({ email: "ada@example.com", password: "pw" }),
    ).resolves.toStrictEqual({
      kind: "refused",
      message: "Invalid email or password",
      status: 401,
    });

    const away = phoneOver({ "/api/auth/sign-in/email": unreachable });
    await expect(
      away.auth.signIn({ email: "ada@example.com", password: "pw" }),
    ).resolves.toStrictEqual({
      kind: "unreachable",
    });
  });

  it("makes an account through the invite gate, beside Better Auth's own routes", async () => {
    const request = {
      email: "ada@example.com",
      inviteCode: "INVITE-1",
      name: "Ada",
      password: "pw",
    };
    const gate = phoneOver({
      "/api/sign-up": json(403, { message: "That invite code doesn't work." }),
    });
    await expect(gate.auth.signUp(request)).resolves.toStrictEqual({
      kind: "refused",
      message: "That invite code doesn't work.",
      status: 403,
    });
    expect(gate.asked).toStrictEqual([{ body: JSON.stringify(request), path: "/api/sign-up" }]);
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
    // the request goes on after it, unawaited
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
