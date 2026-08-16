// ---------------------------------------------------------------------------
// The account, and nothing else.
//
// Better Auth's `bearer()` plugin is what makes a native client possible at
// all: sign-in returns the session token in a `set-auth-token` response header,
// and every later call presents it as `Authorization: Bearer …`. There are no
// cookies here — React Native's fetch has no cookie jar worth trusting across
// app launches, and the Worker's own clients all speak bearer for the same
// reason.
//
// The token is a CREDENTIAL, so it lives in expo-secure-store (the keychain),
// never AsyncStorage. Everything else about the session is re-derived from the
// server on launch rather than cached: a token the server has revoked must not
// leave this app looking signed in.
//
// This module is deliberately hand-rolled over `fetch` rather than
// better-auth/client: the whole surface is three calls, and the client package
// pulls a cookie-shaped session model that does not survive here.
// ---------------------------------------------------------------------------

import * as SecureStore from "expo-secure-store";

import { DEPLOYMENT_ORIGIN } from "@/lib/deployment";
import { createExternalStore } from "@/lib/external-store";

const TOKEN_KEY = "inteligir.sessionToken";

type Account = { readonly email: string; readonly name: string };

/**
 * `loading` is the launch state: a stored token exists but has not been
 * checked yet, and showing either a sign-in form or an account would be a
 * guess. Modelled rather than folded into `signedOut` so the UI never flashes
 * the wrong one.
 */
export type SessionState =
  | { readonly kind: "loading" }
  | { readonly kind: "signedOut" }
  | { readonly kind: "signedIn"; readonly account: Account };

const store = createExternalStore<SessionState>({ kind: "loading" });

export const sessionStore = { get: store.get, subscribe: store.subscribe };

function readToken(): string | null {
  return SecureStore.getItem(TOKEN_KEY);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Better Auth's user object, narrowed to what this app shows. */
function accountFrom(body: unknown): Account | null {
  if (!isRecord(body)) return null;
  const user = body.user;
  if (!isRecord(user) || typeof user.email !== "string") return null;
  return { email: user.email, name: typeof user.name === "string" ? user.name : user.email };
}

/** The message a failed call shows. Better Auth answers a rejected credential
 * with a `message`; a transport failure has none, so it gets one. */
function messageFrom(body: unknown): string {
  if (isRecord(body) && typeof body.message === "string") return body.message;
  return "Something went wrong — try again.";
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

/**
 * Re-derive the session from the server. Called once at launch and after every
 * sign-in, so the app's idea of "signed in" is always something the server
 * agreed to within this launch.
 */
export async function refreshSession(): Promise<void> {
  const token = readToken();
  if (token === null) {
    store.set({ kind: "signedOut" });
    return;
  }
  const response = await fetch(`${DEPLOYMENT_ORIGIN}/api/auth/get-session`, {
    headers: { authorization: `Bearer ${token}` },
  }).catch(() => null);
  if (response === null || !response.ok) {
    // A network failure and a revoked token are indistinguishable from here,
    // and treating both as signed-out is the safe one: the stored token stays,
    // so a later launch on a working network signs back in without retyping.
    store.set({ kind: "signedOut" });
    return;
  }
  const account = accountFrom(await readJson(response));
  store.set(account === null ? { kind: "signedOut" } : { kind: "signedIn", account });
}

export type SignInResult = { readonly ok: true } | { readonly ok: false; readonly error: string };

export async function signIn(email: string, password: string): Promise<SignInResult> {
  const response = await fetch(`${DEPLOYMENT_ORIGIN}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  }).catch(() => null);
  if (response === null) return { ok: false, error: "Couldn't reach the server." };
  const body = await readJson(response);
  if (!response.ok) return { ok: false, error: messageFrom(body) };
  const token = response.headers.get("set-auth-token");
  if (token === null) return { ok: false, error: "The server didn't return a session." };
  await SecureStore.setItemAsync(TOKEN_KEY, token);
  const account = accountFrom(body);
  if (account !== null) store.set({ kind: "signedIn", account });
  else await refreshSession();
  return { ok: true };
}

export async function signOut(): Promise<void> {
  const token = readToken();
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  store.set({ kind: "signedOut" });
  // Best-effort: the local session is already gone, and a revoke that fails
  // must not leave the user looking signed in.
  if (token !== null) {
    await fetch(`${DEPLOYMENT_ORIGIN}/api/auth/sign-out`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    }).catch(() => null);
  }
}
