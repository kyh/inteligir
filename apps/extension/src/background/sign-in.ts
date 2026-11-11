// The browser's own sign-in to its cloud, which the extension rides: Better Auth's session cookie,
// read from the browser's jar (the `cookies` permission over the cloud's one host) and sent as each
// call's bearer, which the cloud's bearer plugin takes only signed, as the cookie's value is.
// Nothing of it is kept: each read meets the jar, so a sign-out on the site signs the extension
// out with it. What is kept is the account last read signed in (./connection), which a save made
// signed out waits for.

import { createAuthClient } from "better-auth/client";
import { browser } from "wxt/browser";

import { CALL_DEADLINE_MS } from "./cloud";
import { cloudOrigin, keepConnection, readConnection } from "./connection";

// what a call goes under: where, as whom, and the cookie it sends as its bearer
export interface Session {
  readonly bearer: string;
  readonly email: string;
  readonly origin: string;
}

export type SignIn =
  // the jar holds the cloud's session cookie, read as the account it names
  | { readonly kind: "signed-in"; readonly session: Session }
  // the jar holds none, or the cloud said its session ended: `email` is the account last signed in
  | { readonly kind: "signed-out"; readonly email: string }
  // no account was ever read signed in here
  | { readonly kind: "none" };

// Better Auth's own name for it, which its `__Secure-` prefix marks on https
const sessionCookieName = (origin: string): string =>
  `${new URL(origin).protocol === "https:" ? "__Secure-" : ""}better-auth.session_token`;

const sessionCookie = async (origin: string): Promise<string | null> => {
  const cookie = await browser.cookies.get({ name: sessionCookieName(origin), url: origin });
  return cookie === null || cookie.value === "" ? null : cookie.value;
};

const signedOut = async (): Promise<SignIn> => {
  const connection = await readConnection();
  return connection === null ? { kind: "none" } : { email: connection.email, kind: "signed-out" };
};

// what the browser holds, with no call: the account last read signed in and the jar's cookie for
// its cloud, which the cloud may since have ended
export const heldSignIn = async (): Promise<SignIn> => {
  const connection = await readConnection();
  if (connection === null) {
    return { kind: "none" };
  }
  const bearer = await sessionCookie(connection.origin);
  return bearer === null
    ? { email: connection.email, kind: "signed-out" }
    : { kind: "signed-in", session: { ...connection, bearer } };
};

type SessionAnswer =
  | { readonly kind: "account"; readonly email: string }
  | { readonly kind: "none" }
  // no answer, or a fault of the cloud's own, which says nothing of the session
  | { readonly kind: "unanswered" };

// Better Auth's own client, its `get-session`: a read that slides the session, sent with the
// browser's credentials so the slid cookie lands in the jar beside its row
const askSession = async (origin: string, bearer: string): Promise<SessionAnswer> => {
  const client = createAuthClient({
    baseURL: origin,
    fetchOptions: { auth: { token: bearer, type: "Bearer" }, timeout: CALL_DEADLINE_MS },
  });
  try {
    const { data, error } = await client.getSession();
    if (error !== null) {
      return { kind: "unanswered" };
    }
    return data === null ? { kind: "none" } : { email: data.user.email, kind: "account" };
  } catch {
    return { kind: "unanswered" };
  }
};

// the cloud at `origin` asked whose session the jar's cookie names, the account it names kept as
// this browser's; null when the cloud did not answer
export const askedSignIn = async (origin: string): Promise<SignIn | null> => {
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
      await keepConnection({ email: answer.email, origin });
      return { kind: "signed-in", session: { bearer, email: answer.email, origin } };
    }
    // no default
  }
};

// the cloud this browser saves to, asked
export const cloudSignIn = async (): Promise<SignIn | null> =>
  await askedSignIn(cloudOrigin(await readConnection()));

// the sign-in a save goes under, with no call while this browser holds an account, since the
// cloud's answer to the save says whether its session still stands; a browser never read signed in
// asks once, so one already signed in on the site saves at its first click
export const saveSignIn = async (): Promise<SignIn> => {
  const held = await heldSignIn();
  return held.kind === "none" ? ((await cloudSignIn()) ?? held) : held;
};
