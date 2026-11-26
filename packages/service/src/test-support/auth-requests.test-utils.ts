import { randomInt } from "node:crypto";

import { AUTH_API_PATHS } from "@repo/contract/account/account-schema";
import { PHONE_ORIGIN } from "@repo/contract/origin";
import { inviteCode } from "@repo/db/auth-schema";
import { db } from "@repo/db/drizzle-client";
import { applySetCookies } from "better-auth/cookies";
import { eq } from "drizzle-orm";
import { expect } from "vitest";
import { z } from "zod";

import { APP_URL } from "../app-url";
import { handleAuthRequest } from "../auth/auth-route";
import { handleInviteSignUp, handleSignUpCode } from "../auth/invite";
import { mintSignInCode } from "../auth/sign-in-code";

export const ORIGIN = APP_URL;

export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

export const PHONE_USER_AGENT = "inteligir/1 CFNetwork/3826.500.111 Darwin/25.0.0";

export const CALLER_IP_HEADER = "x-forwarded-for";

const freshAddress = () =>
  `10.${String(randomInt(256))}.${String(randomInt(256))}.${String(randomInt(1, 255))}`;

interface AppInit {
  readonly body?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly method?: "GET" | "POST";
}

const appRequest = (path: string, { body, headers = {}, method = "GET" }: AppInit) =>
  new Request(new URL(path, ORIGIN), {
    body,
    headers: { [CALLER_IP_HEADER]: freshAddress(), ...headers },
    method,
  });

export const authFetch = async (path: string, init: AppInit = {}) =>
  await handleAuthRequest(appRequest(`/api/auth${path}`, init));

export const authPost = async (
  path: string,
  headers: Record<string, string>,
  body: Record<string, string> = {},
) =>
  await authFetch(path, {
    body: JSON.stringify(body),
    headers: { ...headers, "content-type": "application/json" },
    method: "POST",
  });

const siteRequest = (path: string, body: Record<string, string>, headers: Record<string, string>) =>
  appRequest(path, {
    body: JSON.stringify(body),
    headers: { origin: ORIGIN, ...headers, "content-type": "application/json" },
    method: "POST",
  });

export const signUp = async (body: Record<string, string>, headers: Record<string, string> = {}) =>
  await handleInviteSignUp(siteRequest(AUTH_API_PATHS.signUp, body, headers));

export const askSignUpCode = async (
  body: Record<string, string>,
  headers: Record<string, string> = {},
) => await handleSignUpCode(siteRequest(AUTH_API_PATHS.signUpCode, body, headers));

export { mintSignInCode };

export const mintCode = async (code: string) => {
  await db.insert(inviteCode).values({ code });
};

export const readCode = async (code: string) => {
  const [row] = await db.select().from(inviteCode).where(eq(inviteCode.code, code));

  return row;
};

export const cookieHeaderOf = (response: Response) => {
  const headers = new Headers();
  applySetCookies(headers, response.headers.getSetCookie());

  return headers.get("cookie") ?? "";
};

export const sessionTokenOf = (cookie: string) => {
  const value = cookie
    .split("; ")
    .find((pair) => pair.split("=")[0]?.endsWith("session_token") === true)
    ?.split("=")[1];

  if (value === undefined) {
    throw new Error("no session cookie");
  }

  return value;
};

export const signUpUser = async (email: string) => {
  const code = `TEST-${crypto.randomUUID()}`;
  await mintCode(code);

  const response = await signUp(
    { code: await mintSignInCode(email), email, inviteCode: code, name: "Tester" },
    { "user-agent": BROWSER_USER_AGENT },
  );

  expect(response.status).toBe(200);
  const cookie = cookieHeaderOf(response);
  expect(cookie).toContain("session_token=");

  return { cookie } satisfies { cookie: string };
};

export const signInWithCode = async (email: string, headers: Record<string, string>) =>
  await authPost("/sign-in/email-otp", headers, { email, otp: await mintSignInCode(email) });

export const signInPhone = async (email: string) => {
  const response = await signInWithCode(email, {
    "expo-origin": PHONE_ORIGIN,
    "user-agent": PHONE_USER_AGENT,
  });

  expect(response.status).toBe(200);

  return cookieHeaderOf(response);
};

const sessionSchema = z.looseObject({
  session: z.looseObject({ id: z.string() }),
  user: z.looseObject({ email: z.string(), id: z.string() }),
});

export const sessionOf = async (headers: Record<string, string>) => {
  const response = await authFetch("/get-session", { headers });
  const body: unknown = await response.json();

  return body === null ? null : sessionSchema.parse(body);
};

export const userIdOf = async (cookie: string) => {
  const found = await sessionOf({ cookie });

  if (found === null) {
    throw new Error("no session for that cookie");
  }

  return found.user.id;
};
