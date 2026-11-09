import { readFileSync } from "node:fs";
import { AUTH_API_PATHS } from "@repo/contract/account/account-schema";
import type { SignUpRequest } from "@repo/contract/account/account-schema";
import type { ClientBuild } from "@repo/contract/client-build";
import { PHONE_ORIGIN } from "@repo/contract/origin";
import { z } from "zod";
import { expect } from "./assert";
import { E2E_INVITE_CODE } from "./cloud-worker";

// the account every device signs in as; the password is what a sign-in needs
export const OWNER = { email: "e2e-owner@inteligir.local", password: "e2e-password-1234" };

// the phone the scenarios play is this checkout's, so it says this checkout's version, as the app
// reads it from the same manifest
export const PHONE_BUILD: ClientBuild = {
  platform: "mobile",
  version: z
    .looseObject({ version: z.string() })
    .parse(
      JSON.parse(
        readFileSync(new URL("../../../../apps/mobile/package.json", import.meta.url), "utf-8"),
      ),
    ).version,
};

// a browser on the Worker's own pages, which ship with it and name no build
const ownPage = (origin: string) => ({ origin, "sec-fetch-site": "same-origin" });

const sessionUserSchema = z.looseObject({ user: z.looseObject({ id: z.string() }) });

// what a browser sends back: the name=value of each cookie an answer set
const cookieHeaderOf = (response: Response): string =>
  response.headers
    .getSetCookie()
    .map((setCookie) => setCookie.split(";")[0] ?? "")
    .join("; ");

// the site's sign-up form as its page posts it
export const postSignUp = async (origin: string, request: SignUpRequest): Promise<Response> =>
  await fetch(`${origin}${AUTH_API_PATHS.signUp}`, {
    body: JSON.stringify(request),
    headers: { ...ownPage(origin), "content-type": "application/json" },
    method: "POST",
  });

// the owner's account, made on the site with the run's invite code: the browser's session cookie
export const signUp = async (origin: string): Promise<{ cookie: string; userId: string }> => {
  const response = await postSignUp(origin, {
    name: "E2E Owner",
    ...OWNER,
    inviteCode: E2E_INVITE_CODE,
  });
  expect(response.ok, `sign-up answered ${response.status}`);
  const cookie = cookieHeaderOf(response);
  expect(cookie.includes("session_token="), "sign-up set a session cookie");

  const session = await fetch(`${origin}/api/auth/get-session`, { headers: { cookie, origin } });
  const parsed = sessionUserSchema.safeParse(await session.json());
  expect(parsed.success, "get-session names the signed-up user");
  return { cookie, userId: parsed.data.user.id };
};

// the system networking stack's user agent, which the phone's native requests carry, and the cloud
// names its session by
const PHONE_USER_AGENT = "inteligir/1 CFNetwork/3826.500.111 Darwin/25.0.0";

// the phone's sign-in as its runtime makes it: Better Auth's own route, the app scheme named in
// `expo-origin`, which a native request sends in place of an Origin
export const phoneSignIn = async (origin: string, password: string): Promise<Response> =>
  await fetch(`${origin}/api/auth/sign-in/email`, {
    body: JSON.stringify({ email: OWNER.email, password }),
    headers: {
      "content-type": "application/json",
      "expo-origin": PHONE_ORIGIN,
      "user-agent": PHONE_USER_AGENT,
    },
    method: "POST",
  });

// the owner signed in as a phone: the cookie its `/v1` calls carry
export const signInPhone = async (origin: string): Promise<string> => {
  const response = await phoneSignIn(origin, OWNER.password);
  await response.arrayBuffer();
  expect(response.ok, `the phone's sign-in answered ${String(response.status)}`);
  const cookie = cookieHeaderOf(response);
  expect(cookie.includes("session_token="), "the phone's sign-in set a session cookie");
  return cookie;
};
