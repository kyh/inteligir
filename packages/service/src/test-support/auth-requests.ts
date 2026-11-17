// Requests as the app's routes take them, handed to the handlers apps/web mounts: `/api/auth/*`
// (../auth/auth-route.ts) and `POST /api/sign-up` (../auth/invite.ts). Each comes from an address
// of its own unless a test names one, so the limiters, which stay on as in production, count every
// test apart.

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
import { handleInviteSignUp } from "../auth/invite";

export const ORIGIN = APP_URL;
export const PASSWORD = "test-password-1234";

// the browser the site's sign-up is made in
export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

// the system networking stack's user agent, which the phone's native requests carry
export const PHONE_USER_AGENT = "inteligir/1 CFNetwork/3826.500.111 Darwin/25.0.0";

// the header Better Auth reads an address from off Vercel (../auth/client-ip.ts)
export const CALLER_IP_HEADER = "x-forwarded-for";

export const freshAddress = (): string =>
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

// a Better Auth route as `/api/auth/*` serves it, the door's allowlist included
export const authFetch = async (path: string, init: AppInit = {}): Promise<Response> =>
  await handleAuthRequest(appRequest(`/api/auth${path}`, init));

export const authPost = async (
  path: string,
  headers: Record<string, string>,
  body: Record<string, string> = {},
): Promise<Response> =>
  await authFetch(path, {
    body: JSON.stringify(body),
    headers: { ...headers, "content-type": "application/json" },
    method: "POST",
  });

export const signUp = async (
  body: Record<string, string>,
  headers: Record<string, string> = {},
): Promise<Response> =>
  await handleInviteSignUp(
    appRequest(AUTH_API_PATHS.signUp, {
      body: JSON.stringify(body),
      headers: { origin: ORIGIN, ...headers, "content-type": "application/json" },
      method: "POST",
    }),
  );

export const mintCode = async (code: string): Promise<void> => {
  await db.insert(inviteCode).values({ code });
};

export const readCode = async (code: string) => {
  const [row] = await db.select().from(inviteCode).where(eq(inviteCode.code, code));
  return row;
};

// what a browser sends back: the name=value of each cookie the response set
export const cookieHeaderOf = (response: Response): string => {
  const headers = new Headers();
  applySetCookies(headers, response.headers.getSetCookie());
  return headers.get("cookie") ?? "";
};

export const signUpUser = async (email: string): Promise<{ cookie: string; password: string }> => {
  const code = `TEST-${crypto.randomUUID()}`;
  await mintCode(code);
  const response = await signUp(
    { email, inviteCode: code, name: "Tester", password: PASSWORD },
    { "user-agent": BROWSER_USER_AGENT },
  );
  expect(response.status).toBe(200);
  const cookie = cookieHeaderOf(response);
  expect(cookie).toContain("session_token=");
  return { cookie, password: PASSWORD };
};

// the phone's sign-in as its runtime makes it: Better Auth's own route, the app scheme named in
// `expo-origin`, which a native request sends in place of an Origin
export const signInPhone = async (email: string, password = PASSWORD): Promise<string> => {
  const response = await authPost(
    "/sign-in/email",
    { "expo-origin": PHONE_ORIGIN, "user-agent": PHONE_USER_AGENT },
    { email, password },
  );
  expect(response.status).toBe(200);
  return cookieHeaderOf(response);
};

const sessionSchema = z.looseObject({
  session: z.looseObject({ id: z.string() }),
  user: z.looseObject({ email: z.string(), id: z.string() }),
});

// the session a cookie or a bearer names, or null once it has ended
export const sessionOf = async (headers: Record<string, string>) => {
  const response = await authFetch("/get-session", { headers });
  const body: unknown = await response.json();
  return body === null ? null : sessionSchema.parse(body);
};

export const userIdOf = async (cookie: string): Promise<string> => {
  const found = await sessionOf({ cookie });
  if (found === null) {
    throw new Error("no session for that cookie");
  }
  return found.user.id;
};
