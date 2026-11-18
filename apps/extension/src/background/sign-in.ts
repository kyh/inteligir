import { bytesToHex } from "@noble/hashes/utils.js";
import { createAuthClient } from "better-auth/client";
import { browser } from "wxt/browser";
import type { Browser } from "wxt/browser";

import { CALL_DEADLINE_MS } from "./cloud";
import { cloudOrigin, keepConnection, readConnection } from "./connection";

export interface Session {
  readonly bearer: string;
  readonly email: string;
  readonly origin: string;
}

export type SignIn =
  | { readonly kind: "signed-in"; readonly session: Session }
  | { readonly kind: "signed-out"; readonly email: string }
  | { readonly kind: "none" };

const SESSION_COOKIE = "better-auth.session_token";
const SECURE_SESSION_COOKIE = `__Secure-${SESSION_COOKIE}`;

const sessionCookieName = (origin: string) =>
  new URL(origin).protocol === "https:" ? SECURE_SESSION_COOKIE : SESSION_COOKIE;

export const setsSession = ({ cookie, removed }: Browser.cookies.CookieChangeInfo) =>
  !removed && (cookie.name === SESSION_COOKIE || cookie.name === SECURE_SESSION_COOKIE);

const sessionCookie = async (origin: string) => {
  const cookie = await browser.cookies.get({ name: sessionCookieName(origin), url: origin });

  return cookie === null || cookie.value === "" ? null : cookie.value;
};

const signedOut = async () => {
  const connection = await readConnection();

  return (
    connection === null ? { kind: "none" } : { email: connection.email, kind: "signed-out" }
  ) satisfies SignIn;
};

const digestOf = async (cookie: string) =>
  bytesToHex(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(cookie))),
  );

export const heldSignIn = async () => {
  const connection = await readConnection();

  if (connection === null) {
    return { kind: "none" } satisfies SignIn;
  }

  const origin = await cloudOrigin();
  const bearer = await sessionCookie(origin);

  if (bearer === null) {
    return { email: connection.email, kind: "signed-out" } satisfies SignIn;
  }

  return (
    (await digestOf(bearer)) === connection.cookie
      ? { kind: "signed-in", session: { bearer, email: connection.email, origin } }
      : { kind: "none" }
  ) satisfies SignIn;
};

type SessionAnswer =
  | { readonly kind: "account"; readonly email: string }
  | { readonly kind: "none" }
  | { readonly kind: "unanswered" };

const askSession = async (origin: string, bearer: string) => {
  const client = createAuthClient({
    baseURL: origin,
    fetchOptions: { auth: { token: bearer, type: "Bearer" }, timeout: CALL_DEADLINE_MS },
  });

  try {
    const { data, error } = await client.getSession();

    if (error !== null) {
      return { kind: "unanswered" } satisfies SessionAnswer;
    }

    return (
      data === null ? { kind: "none" } : { email: data.user.email, kind: "account" }
    ) satisfies SessionAnswer;
  } catch {
    return { kind: "unanswered" } satisfies SessionAnswer;
  }
};

export const cloudSignIn = async () => {
  const origin = await cloudOrigin();
  const bearer = await sessionCookie(origin);

  if (bearer === null) {
    return await signedOut();
  }

  const answer = await askSession(origin, bearer);

  switch (answer.kind) {
    case "unanswered": {
      return null;
    }

    case "none": {
      return await signedOut();
    }

    case "account": {
      await keepConnection({ cookie: await digestOf(bearer), email: answer.email });

      return {
        kind: "signed-in",
        session: { bearer, email: answer.email, origin },
      } satisfies SignIn | null;
    }

    default: {
      throw new Error(`unexpected ${String(answer satisfies never)}`);
    }
  }
};

export const saveSignIn = async () => {
  const held = await heldSignIn();

  return held.kind === "none" ? ((await cloudSignIn()) ?? held) : held;
};
